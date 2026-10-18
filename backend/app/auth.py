import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional, Union

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jwt.exceptions import PyJWTError as JWTError
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    JWT_ALGORITHM,
    JWT_SECRET_KEY,
    REFRESH_TOKEN_EXPIRE_DAYS,
)

# Database dependency and models
from .database import get_db
from .models import User
from .schema import UserCreate, UserLogin



oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="token", auto_error=False)


# --- Password Hashing Functions ---
def hash_password(password: str) -> str:
    """Securely hashes a plaintext password using bcrypt."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plaintext password against a stored bcrypt hash."""
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))


# --- JWT Token Functions ---
def create_access_token(
    subject: Union[int, str],
    expires_delta: Optional[timedelta] = None,
) -> str:
    """Generates a signed JWT access token containing subject (sub), expiration (exp), and unique jti."""
    if not JWT_SECRET_KEY:
        raise RuntimeError("JWT_SECRET_KEY environment variable is not configured.")

    now = datetime.now(timezone.utc)
    expire = now + (
        expires_delta if expires_delta else timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )

    payload = {
        "sub": str(subject),
        "type": "access",
        "iat": int(now.timestamp()),
        "exp": expire,
        "jti": str(uuid.uuid4()),
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def create_refresh_token(
    subject: Union[int, str],
    expires_delta: Optional[timedelta] = None,
) -> str:
    """Generates a signed JWT refresh token for persistent sessions."""
    if not JWT_SECRET_KEY:
        raise RuntimeError("JWT_SECRET_KEY environment variable is not configured.")

    now = datetime.now(timezone.utc)
    expire = now + (
        expires_delta if expires_delta else timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    )

    payload = {
        "sub": str(subject),
        "type": "refresh",
        "iat": int(now.timestamp()),
        "exp": expire,
        "jti": str(uuid.uuid4()),
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def verify_refresh_token(token: str) -> int:
    """
    Validates a JWT refresh token, confirms type is 'refresh',
    and returns the user ID integer.
    """
    if not JWT_SECRET_KEY:
        raise RuntimeError("JWT_SECRET_KEY environment variable is not configured.")

    payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
    if payload.get("type") != "refresh":
        raise ValueError("Invalid token type: expected refresh token")
    user_id_raw = payload.get("sub")
    if user_id_raw is None:
        raise ValueError("Refresh token missing subject")
    return int(user_id_raw)


# --- Registration & Login Logic ---
def register_user(user_data: UserCreate, db: Session) -> User:
    """Registers a new user after verifying that the username and email are unique."""
    existing_user = db.scalar(
        select(User).where(
            (User.email == user_data.email) | (User.username == user_data.username)
        )
    )
    if existing_user:
        if existing_user.email == user_data.email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A user with this email is already registered.",
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with this username is already registered.",
        )

    new_user = User(
        username=user_data.username,
        email=user_data.email,
        hashed_password=hash_password(user_data.password),
        is_verified=True,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user


def authenticate_user_by_email(email: str, password: str, db: Session) -> dict:
    """
    Authenticates a user by email and password, returning a JWT access token.
    Enforces strict email lookup without querying by username.
    """
    user = db.scalar(select(User).where(User.email == email))
    if not user or not verify_password(password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = create_access_token(subject=user.id)
    return {
        "access_token": access_token,
        "token_type": "bearer",
    }



def login_user(login_data: UserLogin, db: Session) -> dict:
    """Authenticates a user via JSON payload (email and password)."""
    return authenticate_user_by_email(email=login_data.email, password=login_data.password, db=db)


def login_oauth2(form_data: OAuth2PasswordRequestForm, db: Session) -> dict:
    """
    Authenticates a user via OAuth2 password form data (username & password).
    Interprets form_data.username as the user's email address.
    """
    return authenticate_user_by_email(email=form_data.username, password=form_data.password, db=db)


def decode_access_token_user_id(token: Optional[str]) -> Optional[int]:
    """Decodes a JWT access token and returns the user ID integer, or None if invalid or expired."""
    if not token or not JWT_SECRET_KEY:
        return None
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            return None
        user_id_raw: Optional[str] = payload.get("sub")
        if user_id_raw is None:
            return None
        return int(user_id_raw)
    except (JWTError, ValueError):
        return None


# --- Current-User Dependency ---
def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    """FastAPI dependency to extract, validate the JWT bearer token, and return the authenticated user."""
    if not JWT_SECRET_KEY:
        raise RuntimeError("JWT_SECRET_KEY environment variable is not configured.")

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    user_id = decode_access_token_user_id(token)
    if user_id is None:
        raise credentials_exception

    user = db.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise credentials_exception

    return user


def get_optional_current_user(
    token: Optional[str] = Depends(oauth2_scheme_optional),
    db: Session = Depends(get_db),
) -> Optional[User]:
    """Extracts authenticated user if valid Bearer token is provided; returns None if unauthenticated."""
    user_id = decode_access_token_user_id(token)
    if user_id is None:
        return None

    return db.scalar(select(User).where(User.id == user_id))

