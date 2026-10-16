import hashlib
import hmac
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from sqlalchemy import case, func, select, update
from sqlalchemy.orm import Session

from .config import (
    OTP_MAX_ATTEMPTS,
    OTP_MAX_HOURLY_SENDS,
    OTP_RESEND_COOLDOWN_SECONDS,
    OTP_SECRET_KEY,
    OTP_VALIDITY_SECONDS,
)
from .models import OTPChallenge

logger = logging.getLogger(__name__)


# --- Custom Exception Classes ---

class OTPError(Exception):
    """Base exception for OTP-related operations."""
    pass


class OTPCooldownError(OTPError):
    """Raised when an OTP request occurs during the cooldown window."""
    def __init__(self, retry_after_seconds: int, message: Optional[str] = None):
        self.retry_after_seconds = max(1, retry_after_seconds)
        super().__init__(message or f"Please wait {self.retry_after_seconds} seconds before requesting a new code.")


class OTPRateLimitError(OTPError):
    """Raised when the maximum hourly OTP send limit is exceeded."""
    def __init__(self, message: Optional[str] = None):
        super().__init__(message or "Maximum verification code requests exceeded for this hour. Please try again later.")


class OTPVerificationResult:
    """Structured result returned by verify_otp."""
    def __init__(
        self,
        success: bool,
        message: str,
        challenge: Optional[OTPChallenge] = None,
        attempts_remaining: int = 0,
    ):
        self.success = success
        self.message = message
        self.challenge = challenge
        self.attempts_remaining = attempts_remaining

    def __bool__(self) -> bool:
        return self.success


# --- Core Cryptographic & Generation Functions ---

def generate_otp(length: int = 6) -> str:
    """
    Generates a cryptographically secure numeric OTP using Python's secrets module.
    Preserves leading zeros by formatting with zero-padding and returning as a string.
    """
    if length < 4 or length > 10:
        raise ValueError("OTP length must be between 4 and 10 digits.")
    upper_bound = 10 ** length
    code_int = secrets.randbelow(upper_bound)
    return f"{code_int:0{length}d}"


def hash_otp(otp: str, secret: Optional[str] = None) -> str:
    """
    Computes a keyed HMAC-SHA256 hex digest of the OTP.
    Does not log the OTP or its digest.
    """
    key = secret or OTP_SECRET_KEY
    if not key:
        raise RuntimeError("OTP_SECRET_KEY is not configured in the application environment.")
    
    clean_otp = str(otp).strip()
    return hmac.new(key.encode("utf-8"), clean_otp.encode("utf-8"), hashlib.sha256).hexdigest()


# --- Challenge Lifecycle Management ---

def cancel_otp_challenge(db: Session, challenge: OTPChallenge) -> None:
    """
    Deletes or cancels an OTP challenge when email delivery fails.
    Ensures the user is not left stuck behind an active OTP or resend cooldown.
    """
    try:
        db.delete(challenge)
        db.commit()
    except Exception as exc:
        logger.warning("Failed to delete cancelled challenge %s: %s", getattr(challenge, "id", None), exc)
        db.rollback()
        challenge.is_invalidated = True
        db.commit()


def create_otp_challenge(
    db: Session,
    email: str,
    purpose: str = "registration",
    user_id: Optional[int] = None,
    validity_seconds: int = OTP_VALIDITY_SECONDS,
    max_attempts: int = OTP_MAX_ATTEMPTS,
    secret: Optional[str] = None,
    enforce_rate_limits: bool = True,
    now: Optional[datetime] = None,
) -> Tuple[OTPChallenge, str]:
    """
    Creates a new OTP challenge in PostgreSQL.
    Enforces cooldown and hourly limits, invalidates previous active challenges,
    and returns a tuple of (OTPChallenge, plaintext_otp).

    The plaintext OTP is only returned to the caller for sending via email and must
    never be logged or returned in an API response.
    """
    normalized_email = email.strip().lower()
    current_time = now or datetime.now(timezone.utc)

    if enforce_rate_limits:
        # 1. Check Resend Cooldown against active non-invalidated challenges
        latest_challenge = db.scalar(
            select(OTPChallenge)
            .where(
                OTPChallenge.email == normalized_email,
                OTPChallenge.purpose == purpose,
                OTPChallenge.is_invalidated.is_(False),
                OTPChallenge.is_consumed.is_(False),
            )
            .order_by(OTPChallenge.created_at.desc())
            .limit(1)
        )
        if latest_challenge and latest_challenge.created_at:
            created_at = latest_challenge.created_at
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=timezone.utc)
            elapsed = (current_time - created_at).total_seconds()
            if elapsed < OTP_RESEND_COOLDOWN_SECONDS:
                remaining = int(OTP_RESEND_COOLDOWN_SECONDS - elapsed)
                raise OTPCooldownError(retry_after_seconds=remaining)

        # 2. Check Hourly Send Limit
        one_hour_ago = current_time - timedelta(hours=1)
        hourly_count = db.scalar(
            select(func.count(OTPChallenge.id)).where(
                OTPChallenge.email == normalized_email,
                OTPChallenge.created_at >= one_hour_ago,
            )
        ) or 0
        if hourly_count >= OTP_MAX_HOURLY_SENDS:
            raise OTPRateLimitError()

    # 3. Invalidate Previous Active Challenges for the same email and purpose
    db.execute(
        update(OTPChallenge)
        .where(
            OTPChallenge.email == normalized_email,
            OTPChallenge.purpose == purpose,
            OTPChallenge.is_consumed.is_(False),
            OTPChallenge.is_invalidated.is_(False),
        )
        .values(is_invalidated=True)
    )

    # 4. Generate and Hash OTP
    plaintext_otp = generate_otp(length=6)
    digest = hash_otp(plaintext_otp, secret=secret)
    expires_at = current_time + timedelta(seconds=validity_seconds)

    # 5. Persist Challenge
    challenge = OTPChallenge(
        email=normalized_email,
        user_id=user_id,
        purpose=purpose,
        otp_hash=digest,
        attempts=0,
        max_attempts=max_attempts,
        is_consumed=False,
        is_invalidated=False,
        created_at=current_time,
        expires_at=expires_at,
    )
    db.add(challenge)
    db.commit()
    db.refresh(challenge)

    return challenge, plaintext_otp


def verify_otp(
    db: Session,
    email: str,
    otp: str,
    purpose: str = "registration",
    secret: Optional[str] = None,
    now: Optional[datetime] = None,
) -> OTPVerificationResult:
    """
    Verifies an OTP code against active challenges stored in PostgreSQL.
    Enforces server-side expiry (30s), maximum attempts (5), and atomic single-use consumption.
    Safe against race conditions using conditional atomic database updates.
    """
    normalized_email = email.strip().lower()
    current_time = now or datetime.now(timezone.utc)

    # 1. Fetch the active challenge for email and purpose
    challenge = db.scalar(
        select(OTPChallenge)
        .where(
            OTPChallenge.email == normalized_email,
            OTPChallenge.purpose == purpose,
            OTPChallenge.is_consumed.is_(False),
            OTPChallenge.is_invalidated.is_(False),
        )
        .order_by(OTPChallenge.created_at.desc())
        .limit(1)
    )

    if not challenge:
        return OTPVerificationResult(
            success=False,
            message="No active verification code found for this email.",
            challenge=None,
            attempts_remaining=0,
        )

    # 2. Server-side Expiry Check (current_time >= expires_at strictly rejects)
    expires_at = challenge.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if current_time >= expires_at:
        challenge.is_invalidated = True
        db.commit()
        return OTPVerificationResult(
            success=False,
            message="Verification code has expired. Please request a new one.",
            challenge=challenge,
            attempts_remaining=0,
        )

    # 3. Check Attempts Cap
    if challenge.attempts >= challenge.max_attempts:
        challenge.is_invalidated = True
        db.commit()
        return OTPVerificationResult(
            success=False,
            message="Maximum verification attempts exceeded. Please request a new code.",
            challenge=challenge,
            attempts_remaining=0,
        )

    # 4. Digest Verification (Constant-Time Comparison)
    candidate_digest = hash_otp(otp, secret=secret)
    is_valid = hmac.compare_digest(candidate_digest, challenge.otp_hash)

    if not is_valid:
        # Atomic attempt increment in database to eliminate race conditions
        stmt = (
            update(OTPChallenge)
            .where(OTPChallenge.id == challenge.id)
            .values(
                attempts=OTPChallenge.attempts + 1,
                is_invalidated=case(
                    (OTPChallenge.attempts + 1 >= OTPChallenge.max_attempts, True),
                    else_=OTPChallenge.is_invalidated,
                ),
            )
        )
        db.execute(stmt)
        db.commit()
        db.refresh(challenge)

        remaining = max(0, challenge.max_attempts - challenge.attempts)
        if remaining > 0:
            return OTPVerificationResult(
                success=False,
                message=f"Invalid verification code. {remaining} attempt(s) remaining.",
                challenge=challenge,
                attempts_remaining=remaining,
            )
        return OTPVerificationResult(
            success=False,
            message="Maximum verification attempts exceeded. Please request a new code.",
            challenge=challenge,
            attempts_remaining=0,
        )


    # 5. Atomic Consumption (Single-Use Guarantee against Concurrent Requests)
    stmt = (
        update(OTPChallenge)
        .where(
            OTPChallenge.id == challenge.id,
            OTPChallenge.is_consumed.is_(False),
            OTPChallenge.is_invalidated.is_(False),
            OTPChallenge.expires_at > current_time,
            OTPChallenge.attempts < OTPChallenge.max_attempts,
        )
        .values(
            is_consumed=True,
            consumed_at=current_time,
        )
    )
    result = db.execute(stmt)
    db.commit()

    if result.rowcount != 1:
        # Another concurrent request already consumed, invalidated, or expired this code
        return OTPVerificationResult(
            success=False,
            message="Verification code has already been used or expired.",
            challenge=challenge,
            attempts_remaining=0,
        )

    db.refresh(challenge)
    return OTPVerificationResult(
        success=True,
        message="Verification successful.",
        challenge=challenge,
        attempts_remaining=challenge.max_attempts - challenge.attempts,
    )
