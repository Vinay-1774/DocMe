import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import URL, create_engine, select, text
from sqlalchemy.orm import sessionmaker

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from backend.app import config
from backend.app.auth import hash_password
from backend.app.database import Base, get_db
from backend.app.main import app
from backend.app.models import User

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
    """Initializes the isolated test database schema."""
    with test_engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))
        conn.commit()
    Base.metadata.create_all(bind=test_engine)
    yield
    Base.metadata.drop_all(bind=test_engine)


@pytest.fixture(autouse=True)
def clean_users():
    """Wipe users table before each test to guarantee test isolation."""
    with TestSessionLocal() as session:
        session.query(User).delete()
        session.commit()
    yield


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_registration_and_immediate_login(client):
    """
    Test 1: Registration creates the user directly with no email/OTP needed.
    Test 2: The user can immediately log in with their password.
    """
    reg_payload = {
        "username": "alice_researcher",
        "email": "alice@university.edu",
        "password": "Password123!",
    }
    reg_resp = client.post("/register", json=reg_payload)
    assert reg_resp.status_code == 201, reg_resp.text
    user_data = reg_resp.json()
    assert user_data["username"] == "alice_researcher"
    assert user_data["email"] == "alice@university.edu"
    assert user_data["is_verified"] is True
    assert "id" in user_data

    # Verify user exists in DB
    with TestSessionLocal() as session:
        db_user = session.scalar(select(User).where(User.email == "alice@university.edu"))
        assert db_user is not None
        assert db_user.username == "alice_researcher"
        assert db_user.is_verified is True

    # Immediate login succeeds
    login_payload = {
        "email": "alice@university.edu",
        "password": "Password123!",
    }
    login_resp = client.post("/login", json=login_payload)
    assert login_resp.status_code == 200, login_resp.text
    token_data = login_resp.json()
    assert "access_token" in token_data
    assert token_data["token_type"] == "bearer"
    # Ensure refresh cookie is set
    assert "rp_refresh_token" in login_resp.cookies


def test_duplicate_registration_rejected(client):
    """
    Test that duplicate email and duplicate username are rejected with 400 Bad Request.
    """
    client.post(
        "/register",
        json={
            "username": "bob_scientist",
            "email": "bob@lab.org",
            "password": "Password123!",
        },
    )

    # Duplicate email
    dup_email_resp = client.post(
        "/register",
        json={
            "username": "bob_other",
            "email": "bob@lab.org",
            "password": "Password123!",
        },
    )
    assert dup_email_resp.status_code == 400
    assert "email is already registered" in dup_email_resp.json()["detail"].lower()

    # Duplicate username
    dup_user_resp = client.post(
        "/register",
        json={
            "username": "bob_scientist",
            "email": "another_bob@lab.org",
            "password": "Password123!",
        },
    )
    assert dup_user_resp.status_code == 400
    assert "username is already registered" in dup_user_resp.json()["detail"].lower()


def test_invalid_password_rejected(client):
    """
    Test that login fails with 401 Unauthorized when an incorrect password is provided.
    """
    client.post(
        "/register",
        json={
            "username": "charlie_test",
            "email": "charlie@test.com",
            "password": "CorrectPassword123!",
        },
    )

    bad_login_resp = client.post(
        "/login",
        json={
            "email": "charlie@test.com",
            "password": "WrongPassword999!",
        },
    )
    assert bad_login_resp.status_code == 401
    assert "invalid email or password" in bad_login_resp.json()["detail"].lower()


def test_existing_unverified_user_can_login(client):
    """
    Test that existing users who had is_verified=False can log in without verification error.
    """
    with TestSessionLocal() as session:
        legacy_user = User(
            username="legacy_unverified",
            email="legacy@univ.edu",
            hashed_password=hash_password("LegacyPass123!"),
            is_verified=False,
        )
        session.add(legacy_user)
        session.commit()

    login_resp = client.post(
        "/login",
        json={
            "email": "legacy@univ.edu",
            "password": "LegacyPass123!",
        },
    )
    assert login_resp.status_code == 200, login_resp.text
    assert "access_token" in login_resp.json()


def test_refresh_token_session(client):
    """
    Test that the refresh token cookie issued on login can be used to refresh the access token.
    """
    client.post(
        "/register",
        json={
            "username": "diana_refresh",
            "email": "diana@test.com",
            "password": "Password123!",
        },
    )

    login_resp = client.post(
        "/login",
        json={
            "email": "diana@test.com",
            "password": "Password123!",
        },
    )
    assert login_resp.status_code == 200
    refresh_cookie = login_resp.cookies.get("rp_refresh_token")
    assert refresh_cookie is not None

    # Call /refresh with cookie
    refresh_resp = client.post("/refresh", cookies={"rp_refresh_token": refresh_cookie})
    assert refresh_resp.status_code == 200, refresh_resp.text
    refreshed_data = refresh_resp.json()
    assert "access_token" in refreshed_data


from backend.app.database import Base, get_db, sync_db_sequences


def test_obsolete_otp_endpoints_return_404(client):
    """
    Test that obsolete OTP routes have been removed and return 404 Not Found.
    """
    res1 = client.post("/auth/otp/request", json={"email": "anyone@test.com"})
    assert res1.status_code == 404

    res2 = client.post("/auth/otp/resend", json={"email": "anyone@test.com"})
    assert res2.status_code == 404

    res3 = client.post("/auth/otp/verify", json={"email": "anyone@test.com", "otp": "123456"})
    assert res3.status_code == 404


def test_primary_key_sequence_synchronization(client):
    """
    Test that if rows are manually inserted with out-of-order IDs,
    sync_db_sequences() detects and repairs the sequence so future
    inserts generate unique IDs without pkey violation.
    """
    # 1. Manually insert a user with a manual high ID (simulating out-of-sync sequence)
    with TestSessionLocal() as session:
        manual_user = User(
            id=500,
            username="manual_high_id",
            email="manual500@test.com",
            hashed_password=hash_password("Pass123!"),
            is_verified=True,
        )
        session.add(manual_user)
        session.commit()

    # 2. Run sync_db_sequences on test engine
    results = sync_db_sequences(bind_engine=test_engine)
    user_sync = next((r for r in results if r.get("table") == "users"), None)
    assert user_sync is not None
    assert user_sync["status"] == "synchronized"
    assert user_sync["synchronized_to"] == 500

    # 3. New registration without explicit ID must receive ID > 500 without unique constraint violation
    reg_resp = client.post(
        "/register",
        json={
            "username": "after_sync_user",
            "email": "after_sync@test.com",
            "password": "Password123!",
        },
    )
    assert reg_resp.status_code == 201, reg_resp.text
    new_user_data = reg_resp.json()
    assert new_user_data["id"] == 501

