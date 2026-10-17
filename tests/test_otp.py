import concurrent.futures
import hashlib
import hmac
import os
import sys
from pathlib import Path
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import URL, create_engine, select, text
from sqlalchemy.orm import sessionmaker

# Ensure project root is in sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from backend.app import config
from backend.app.database import Base, get_db
from backend.app.models import OTPChallenge, User
from backend.app.main import app

from backend.app.otp import (
    OTPCooldownError,
    OTPRateLimitError,
    create_otp_challenge,
    generate_otp,
    hash_otp,
    verify_otp,
)
from backend.app.email import EmailDeliveryError, send_otp_email

TEST_DB_NAME = "research_platform_test"

test_db_url = URL.create(
    drivername="postgresql+psycopg",
    username=config.DB_USER,
    password=config.DB_PASSWORD,
    host=config.DB_HOST,
    port=config.DB_PORT,
    database=TEST_DB_NAME,
)

test_engine = create_engine(test_db_url, pool_pre_ping=True)
TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


def override_get_db():
    db = TestSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(scope="session", autouse=True)
def setup_test_db():
    """Initializes the isolated test database schema including OTPChallenge."""
    with test_engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))
        conn.commit()
    Base.metadata.create_all(bind=test_engine)
    with test_engine.connect() as conn:
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT TRUE;"))
        conn.commit()
    yield
    Base.metadata.drop_all(bind=test_engine)


@pytest.fixture(autouse=True)
def clean_otp_tables():
    """Wipes out OTP challenges and test users between tests."""
    yield
    with test_engine.connect() as conn:
        conn.execute(text("DELETE FROM otp_challenges;"))
        conn.execute(text("DELETE FROM users WHERE email LIKE '%@example.com';"))
        conn.commit()


@pytest.fixture
def db_session():
    db = TestSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def client():
    return TestClient(app)


# ==============================================================================
# Unit Tests: OTP Generation & Hashing
# ==============================================================================

def test_generate_otp_format_and_leading_zeros():
    """Verifies that generated OTPs are 6-digit strings preserving leading zeros."""
    # 1. Statistical check over 500 samples
    for _ in range(500):
        code = generate_otp(6)
        assert isinstance(code, str)
        assert len(code) == 6
        assert code.isdigit()

    # 2. Strict leading zeros preservation check with mock
    with patch("secrets.randbelow", return_value=7):
        code = generate_otp(6)
        assert code == "000007"
        assert len(code) == 6

    with patch("secrets.randbelow", return_value=42):
        code = generate_otp(6)
        assert code == "000042"

    with patch("secrets.randbelow", return_value=0):
        code = generate_otp(6)
        assert code == "000000"


def test_hash_otp_keyed_hmac():
    """Verifies HMAC-SHA256 digest computation with dedicated secret."""
    secret = "test-dedicated-hmac-secret-123456"
    otp = "042189"

    digest1 = hash_otp(otp, secret=secret)
    assert len(digest1) == 64
    assert isinstance(digest1, str)

    # Determinism
    digest2 = hash_otp(otp, secret=secret)
    assert digest1 == digest2

    # Different secret must produce different digest
    digest_different_secret = hash_otp(otp, secret="different-secret-789")
    assert digest1 != digest_different_secret

    # Verify standard HMAC-SHA256 calculation
    expected = hmac.new(secret.encode("utf-8"), otp.encode("utf-8"), hashlib.sha256).hexdigest()
    assert digest1 == expected


# ==============================================================================
# Unit Tests: Challenge Creation & Verification Lifecycle
# ==============================================================================

def test_create_otp_challenge_persistence(db_session):
    """Verifies challenge is persisted in PostgreSQL with digest, not plaintext code."""
    email = "researcher1@example.com"
    challenge, plaintext_otp = create_otp_challenge(
        db=db_session,
        email=email,
        purpose="registration",
        secret="test-secret",
    )

    assert challenge.id is not None
    assert challenge.email == email
    assert challenge.purpose == "registration"
    assert challenge.is_consumed is False
    assert challenge.is_invalidated is False
    assert challenge.attempts == 0
    assert challenge.max_attempts == 5

    # Check stored hash matches computed hash, and plaintext OTP is NOT in database
    computed_hash = hash_otp(plaintext_otp, secret="test-secret")
    assert challenge.otp_hash == computed_hash
    assert plaintext_otp != challenge.otp_hash


def test_valid_otp_verification(db_session):
    """Verifies that a valid OTP is successfully verified and marked consumed."""
    email = "researcher2@example.com"
    challenge, plaintext_otp = create_otp_challenge(
        db=db_session,
        email=email,
        purpose="registration",
        secret="test-secret",
    )

    result = verify_otp(
        db=db_session,
        email=email,
        otp=plaintext_otp,
        purpose="registration",
        secret="test-secret",
    )

    assert result.success is True
    assert result.challenge.is_consumed is True
    assert result.challenge.consumed_at is not None


def test_incorrect_otp_increments_attempts(db_session):
    """Verifies that an incorrect OTP increments attempts and reports remaining count."""
    email = "researcher3@example.com"
    challenge, plaintext_otp = create_otp_challenge(
        db=db_session,
        email=email,
        purpose="registration",
        secret="test-secret",
    )

    wrong_otp = "999999" if plaintext_otp != "999999" else "888888"
    result = verify_otp(
        db=db_session,
        email=email,
        otp=wrong_otp,
        purpose="registration",
        secret="test-secret",
    )

    assert result.success is False
    assert "Invalid verification code" in result.message
    assert result.attempts_remaining == 4

    db_session.refresh(challenge)
    assert challenge.attempts == 1
    assert challenge.is_consumed is False
    assert challenge.is_invalidated is False


def test_five_failed_attempts_invalidates_challenge(db_session):
    """Verifies that 5 failed attempts invalidates the challenge permanently."""
    email = "researcher4@example.com"
    challenge, plaintext_otp = create_otp_challenge(
        db=db_session,
        email=email,
        purpose="registration",
        secret="test-secret",
    )

    wrong_otp = "999999" if plaintext_otp != "999999" else "888888"

    for attempt in range(1, 5):
        res = verify_otp(db=db_session, email=email, otp=wrong_otp, secret="test-secret")
        assert res.success is False
        assert res.attempts_remaining == 5 - attempt

    # 5th attempt
    res5 = verify_otp(db=db_session, email=email, otp=wrong_otp, secret="test-secret")
    assert res5.success is False
    assert "Maximum verification attempts exceeded" in res5.message
    assert res5.attempts_remaining == 0

    db_session.refresh(challenge)
    assert challenge.attempts == 5
    assert challenge.is_invalidated is True

    # Even if user now provides the CORRECT OTP, it must be rejected!
    res_correct = verify_otp(db=db_session, email=email, otp=plaintext_otp, secret="test-secret")
    assert res_correct.success is False


def test_expiry_after_30_seconds_with_controlled_timestamps(db_session):
    """Verifies that OTP expires after exactly 30 seconds using controlled timestamps."""
    email = "researcher5@example.com"
    t0 = datetime(2026, 10, 16, 12, 0, 0, tzinfo=timezone.utc)

    challenge, plaintext_otp = create_otp_challenge(
        db=db_session,
        email=email,
        purpose="registration",
        validity_seconds=30,
        secret="test-secret",
        now=t0,
    )

    # At t0 + 29 seconds: still valid
    res_valid = verify_otp(
        db=db_session,
        email=email,
        otp=plaintext_otp,
        secret="test-secret",
        now=t0 + timedelta(seconds=29),
    )
    assert res_valid.success is True

    # Create another challenge at t0
    challenge2, plaintext_otp2 = create_otp_challenge(
        db=db_session,
        email="researcher5b@example.com",
        purpose="registration",
        validity_seconds=30,
        secret="test-secret",
        now=t0,
    )

    # At t0 + 31 seconds: expired
    res_expired = verify_otp(
        db=db_session,
        email="researcher5b@example.com",
        otp=plaintext_otp2,
        secret="test-secret",
        now=t0 + timedelta(seconds=31),
    )
    assert res_expired.success is False
    assert "expired" in res_expired.message.lower()

    db_session.refresh(challenge2)
    assert challenge2.is_invalidated is True


def test_resend_cooldown(db_session):
    """Verifies that requesting a new OTP before cooldown elapses raises OTPCooldownError."""
    email = "researcher6@example.com"
    t0 = datetime(2026, 10, 16, 12, 0, 0, tzinfo=timezone.utc)

    # First request at t0
    create_otp_challenge(
        db=db_session,
        email=email,
        now=t0,
        secret="test-secret",
    )

    # Second request at t0 + 10s (cooldown is 30s)
    with pytest.raises(OTPCooldownError) as exc_info:
        create_otp_challenge(
            db=db_session,
            email=email,
            now=t0 + timedelta(seconds=10),
            secret="test-secret",
        )
    assert exc_info.value.retry_after_seconds == 20

    # Third request at t0 + 31s: succeeds!
    challenge3, otp3 = create_otp_challenge(
        db=db_session,
        email=email,
        now=t0 + timedelta(seconds=31),
        secret="test-secret",
    )
    assert challenge3.id is not None


def test_replacement_otp_invalidates_previous_challenge(db_session):
    """Verifies that issuing a new OTP invalidates the previous active OTP for the same email/purpose."""
    email = "researcher7@example.com"
    t0 = datetime(2026, 10, 16, 12, 0, 0, tzinfo=timezone.utc)

    challenge1, otp1 = create_otp_challenge(
        db=db_session,
        email=email,
        now=t0,
        secret="test-secret",
    )

    # Replacement requested after cooldown at t0 + 35s
    challenge2, otp2 = create_otp_challenge(
        db=db_session,
        email=email,
        now=t0 + timedelta(seconds=35),
        secret="test-secret",
    )

    # First challenge must be invalidated
    db_session.refresh(challenge1)
    assert challenge1.is_invalidated is True

    # Attempting to verify with old OTP1 must fail
    res_old = verify_otp(
        db=db_session,
        email=email,
        otp=otp1,
        now=t0 + timedelta(seconds=36),
        secret="test-secret",
    )
    assert res_old.success is False

    # Verifying with new OTP2 must succeed
    res_new = verify_otp(
        db=db_session,
        email=email,
        otp=otp2,
        now=t0 + timedelta(seconds=36),
        secret="test-secret",
    )
    assert res_new.success is True


def test_single_use_behavior(db_session):
    """Verifies that an OTP can only be used once."""
    email = "researcher8@example.com"
    challenge, plaintext_otp = create_otp_challenge(
        db=db_session,
        email=email,
        secret="test-secret",
    )

    # First verification: succeeds
    res1 = verify_otp(db=db_session, email=email, otp=plaintext_otp, secret="test-secret")
    assert res1.success is True

    # Immediate second verification: must fail (already consumed)
    res2 = verify_otp(db=db_session, email=email, otp=plaintext_otp, secret="test-secret")
    assert res2.success is False
    assert "no active verification code" in res2.message.lower() or "already been used" in res2.message.lower()


def test_concurrent_verification_race_condition(db_session):
    """
    Verifies atomic consumption under concurrent load.
    10 threads attempt to verify the exact same OTP concurrently.
    Exactly 1 thread must succeed, and 9 must fail.
    """
    email = "researcher9@example.com"
    challenge, plaintext_otp = create_otp_challenge(
        db=db_session,
        email=email,
        secret="test-secret",
    )

    def attempt_verify(thread_id: int):
        thread_db = TestSessionLocal()
        try:
            return verify_otp(
                db=thread_db,
                email=email,
                otp=plaintext_otp,
                secret="test-secret",
            )
        finally:
            thread_db.close()

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(attempt_verify, i) for i in range(10)]
        results = [f.result() for f in concurrent.futures.as_completed(futures)]

    success_count = sum(1 for r in results if r.success is True)
    failure_count = sum(1 for r in results if r.success is False)

    assert success_count == 1
    assert failure_count == 9


def test_hourly_rate_limit(db_session):
    """Verifies that exceeding the hourly send limit triggers OTPRateLimitError."""
    email = "researcher10@example.com"
    t0 = datetime(2026, 10, 16, 12, 0, 0, tzinfo=timezone.utc)

    # Generate 5 challenges across 5 cooldown periods within the hour
    for i in range(5):
        create_otp_challenge(
            db=db_session,
            email=email,
            now=t0 + timedelta(seconds=i * 35),
            secret="test-secret",
        )

    # 6th request within the hour must be blocked
    with pytest.raises(OTPRateLimitError):
        create_otp_challenge(
            db=db_session,
            email=email,
            now=t0 + timedelta(seconds=200),
            secret="test-secret",
        )


# ==============================================================================
# Integration Tests: FastAPI Endpoints & Registration
# ==============================================================================

def test_api_otp_request_non_enumeration(client, db_session):
    """Verifies that requesting an OTP never reveals whether an email is registered."""
    unregistered_email = "nonexistent@example.com"
    registered_email = "registered@example.com"

    # Register one user and mark as verified
    client.post(
        "/register",
        json={"username": "registered_user", "email": registered_email, "password": "password123"},
    )
    user = db_session.scalar(select(User).where(User.email == registered_email))
    if user:
        user.is_verified = True
        db_session.commit()

    with patch("backend.app.main.send_otp_email", return_value=True):
        resp_unreg = client.post(
            "/auth/otp/request",
            json={"email": unregistered_email, "purpose": "registration"},
        )
        resp_reg = client.post(
            "/auth/otp/request",
            json={"email": registered_email, "purpose": "registration"},
        )

    assert resp_unreg.status_code == 200
    assert resp_reg.status_code == 200
    # Both responses must be identical
    assert resp_unreg.json()["message"] == resp_reg.json()["message"]
    assert "eligible" in resp_unreg.json()["message"]


def test_api_register_with_valid_otp(client, db_session):
    """Verifies that registration with a valid OTP succeeds and sets is_verified=True."""
    email = "otp_newuser@example.com"

    # Create challenge directly to obtain OTP
    challenge, plaintext_otp = create_otp_challenge(
        db=db_session,
        email=email,
        purpose="registration",
    )

    resp = client.post(
        "/register",
        json={
            "username": "otp_newuser",
            "email": email,
            "password": "password123",
            "otp": plaintext_otp,
        },
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["email"] == email
    assert data["is_verified"] is True

    # User can log in immediately
    login_resp = client.post(
        "/login",
        json={"email": email, "password": "password123"},
    )
    assert login_resp.status_code == 200
    assert "access_token" in login_resp.json()


def test_api_register_with_invalid_otp(client, db_session):
    """Verifies that registration with an invalid OTP is rejected."""
    email = "otp_badcode@example.com"

    create_otp_challenge(
        db=db_session,
        email=email,
        purpose="registration",
    )

    resp = client.post(
        "/register",
        json={
            "username": "otp_badcode",
            "email": email,
            "password": "password123",
            "otp": "000000",
        },
    )

    assert resp.status_code == 400
    assert "Invalid verification code" in resp.json()["detail"]


def test_email_delivery_failure_handling(client, db_session):
    """Verifies that when email delivery fails, the API returns HTTP 503 and does not claim success."""
    email = "delivery_fail@example.com"

    with patch("backend.app.main.send_otp_email", side_effect=EmailDeliveryError("SMTP connection timed out")):
        resp = client.post(
            "/auth/otp/request",
            json={"email": email, "purpose": "registration"},
        )

    assert resp.status_code == 503
    assert "Unable to deliver verification email" in resp.json()["detail"]


def test_registration_initiates_otp_challenge_and_email(client, db_session):
    """Verifies that registration triggers create_otp_challenge and send_otp_email when verification is required."""
    email = "needs_verify@example.com"
    username = "needs_verify"

    with patch("backend.app.config.REQUIRE_EMAIL_VERIFICATION", True):
        with patch("backend.app.auth.send_otp_email") as mock_send_email:
            resp = client.post(
                "/register",
                json={"username": username, "email": email, "password": "password123"},
            )

            assert resp.status_code == 201
            data = resp.json()
            assert data["email"] == email
            assert data["is_verified"] is False
            assert mock_send_email.called
            call_kwargs = mock_send_email.call_args[1]
            assert call_kwargs["to_email"] == email
            assert len(call_kwargs["otp"]) == 6

            # Verify challenge exists in DB
            challenge = db_session.scalar(
                select(OTPChallenge).where(OTPChallenge.email == email, OTPChallenge.is_consumed.is_(False))
            )
            assert challenge is not None
            assert challenge.attempts == 0


def test_unverified_account_cannot_login_when_policy_requires(client, db_session):
    """Verifies unverified users receive 403 Forbidden on login when verification policy is active."""
    email = "blocked_user@example.com"
    username = "blocked_user"

    with patch("backend.app.config.REQUIRE_EMAIL_VERIFICATION", True):
        with patch("backend.app.auth.send_otp_email"):
            client.post(
                "/register",
                json={"username": username, "email": email, "password": "password123"},
            )

        # Login must be rejected with 403 Forbidden
        login_resp = client.post(
            "/login",
            json={"email": email, "password": "password123"},
        )
        assert login_resp.status_code == 403
        assert "not verified" in login_resp.json()["detail"].lower()


def test_otp_verify_endpoint_marks_user_verified_and_allows_login(client, db_session):
    """Verifies that verifying OTP marks the user is_verified=True and unblocks login."""
    email = "complete_verify@example.com"
    username = "complete_verify"
    captured_otp = None

    def capture_send(to_email, otp, purpose):
        nonlocal captured_otp
        captured_otp = otp
        return True

    with patch("backend.app.config.REQUIRE_EMAIL_VERIFICATION", True):
        with patch("backend.app.auth.send_otp_email", side_effect=capture_send):
            reg_resp = client.post(
                "/register",
                json={"username": username, "email": email, "password": "password123"},
            )
            assert reg_resp.status_code == 201

        assert captured_otp is not None

        # Verify the OTP via endpoint
        verify_resp = client.post(
            "/auth/otp/verify",
            json={"email": email, "otp": captured_otp, "purpose": "registration"},
        )
        assert verify_resp.status_code == 200
        assert "success" in verify_resp.json()["status"]

        # Check DB state
        db_user = db_session.scalar(select(User).where(User.email == email))
        assert db_user.is_verified is True

        # User can now log in successfully
        login_resp = client.post(
            "/login",
            json={"email": email, "password": "password123"},
        )
        assert login_resp.status_code == 200
        assert "access_token" in login_resp.json()


def test_registration_smtp_failure_safely_handled_without_locking_user(client, db_session):
    """
    Verifies that when SMTP email sending fails during registration:
    1. HTTP 503 is returned.
    2. The OTP challenge is deleted so user is NOT stuck behind an active OTP or resend cooldown.
    3. User data is preserved in DB.
    """
    email = "smtp_fail_preserve@example.com"
    username = "smtp_fail_preserve"

    with patch("backend.app.config.REQUIRE_EMAIL_VERIFICATION", True):
        with patch("backend.app.auth.send_otp_email", side_effect=EmailDeliveryError("Connection refused")):
            reg_resp = client.post(
                "/register",
                json={"username": username, "email": email, "password": "password123"},
            )

        assert reg_resp.status_code == 503

        # User data must be preserved in DB
        user = db_session.scalar(select(User).where(User.email == email))
        assert user is not None
        assert user.is_verified is False

        # No active challenge or cooldown remains
        challenge = db_session.scalar(select(OTPChallenge).where(OTPChallenge.email == email))
        assert challenge is None

        # Immediate resend request must NOT be blocked by cooldown
        with patch("backend.app.main.send_otp_email", return_value=True):
            resend_resp = client.post(
                "/auth/otp/request",
                json={"email": email, "purpose": "registration"},
            )
            assert resend_resp.status_code == 200


def test_exact_expiry_at_30_seconds_boundary(db_session):
    """Verifies that current_time >= expires_at strictly rejects the OTP."""
    email = "boundary_expiry@example.com"
    t0 = datetime(2026, 10, 16, 12, 0, 0, tzinfo=timezone.utc)

    challenge, plaintext_otp = create_otp_challenge(
        db=db_session,
        email=email,
        purpose="registration",
        validity_seconds=30,
        secret="test-secret",
        now=t0,
    )

    # Exactly at expires_at (t0 + 30s): current_time >= expires_at must reject!
    exact_expiry_time = t0 + timedelta(seconds=30)
    res_exact = verify_otp(
        db=db_session,
        email=email,
        otp=plaintext_otp,
        secret="test-secret",
        now=exact_expiry_time,
    )
    assert res_exact.success is False
    assert "expired" in res_exact.message.lower()


def test_concurrent_incorrect_attempts_atomic_increment(db_session):
    """Verifies that concurrent incorrect verification attempts are counted atomically without race conditions."""
    email = "atomic_attempts@example.com"
    challenge, plaintext_otp = create_otp_challenge(
        db=db_session,
        email=email,
        secret="test-secret",
    )

    def send_wrong_otp():
        thread_db = TestSessionLocal()
        try:
            return verify_otp(
                db=thread_db,
                email=email,
                otp="000000",
                secret="test-secret",
            )
        finally:
            thread_db.close()

    # Dispatch 5 concurrent wrong attempts
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(send_wrong_otp) for _ in range(5)]
        results = [f.result() for f in concurrent.futures.as_completed(futures)]

    # All 5 attempts must have failed
    assert all(r.success is False for r in results)

    # Challenge must have exactly 5 attempts and be invalidated
    db_session.refresh(challenge)
    assert challenge.attempts == 5
    assert challenge.is_invalidated is True

