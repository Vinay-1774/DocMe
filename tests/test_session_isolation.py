import io
import sys
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import URL, create_engine, text
from sqlalchemy.orm import sessionmaker

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from backend.app import config
from backend.app.auth import create_refresh_token
from backend.app.database import Base, get_db
from backend.app.main import app
from backend.app.models import User, Document

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
    with test_engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))
        conn.commit()
    Base.metadata.create_all(bind=test_engine)
    yield
    Base.metadata.drop_all(bind=test_engine)


@pytest.fixture(autouse=True)
def clean_data():
    with TestSessionLocal() as session:
        session.query(Document).delete()
        session.query(User).delete()
        session.commit()
    yield


def test_user_session_and_data_isolation():
    """
    Scenario 1: User A logs in on Browser A.
    Scenario 2: User B opens the same public URL in a separate browser/window and must be asked to log in.
    Scenario 3: User B logs in and sees their own account, not User A's account or private data.
    Scenario 4: User B cannot access User A's private resources by changing IDs in API requests.
    Scenario 5: Logging out User A does not log out User B's separate session.
    Scenario 6: Refreshing preserves only the current browser's valid session.
    Scenario 7: Refresh token cannot be forged as an access token.
    """
    # Create two independent clients representing Browser A and Browser B
    client_a = TestClient(app)
    client_b = TestClient(app)

    # 1. Register User A and User B
    reg_a = client_a.post("/register", json={
        "username": "user_a",
        "email": "user_a@test.com",
        "password": "PasswordA123!",
    })
    assert reg_a.status_code == 201
    user_a_id = reg_a.json()["id"]

    reg_b = client_b.post("/register", json={
        "username": "user_b",
        "email": "user_b@test.com",
        "password": "PasswordB123!",
    })
    assert reg_b.status_code == 201
    user_b_id = reg_b.json()["id"]

    # 2. User A logs in on Browser A
    login_a = client_a.post("/login", json={"email": "user_a@test.com", "password": "PasswordA123!"})
    assert login_a.status_code == 200
    token_a = login_a.json()["access_token"]
    assert "rp_refresh_token" in login_a.cookies

    # 3. Browser B has no credentials or cookies yet -> protected endpoints must reject with 401
    unauth_resp = client_b.get("/me")
    assert unauth_resp.status_code == 401
    unauth_docs = client_b.get("/documents")
    assert unauth_docs.status_code == 401

    # Attempting to refresh on Browser B without a cookie returns 401 (asks user to log in)
    refresh_unauth = client_b.post("/refresh")
    assert refresh_unauth.status_code == 401

    # 4. User B logs in on Browser B
    login_b = client_b.post("/login", json={"email": "user_b@test.com", "password": "PasswordB123!"})
    assert login_b.status_code == 200
    token_b = login_b.json()["access_token"]
    assert "rp_refresh_token" in login_b.cookies

    # 5. Verify /me isolation: Browser A returns User A, Browser B returns User B
    me_a = client_a.get("/me", headers={"Authorization": f"Bearer {token_a}"})
    assert me_a.status_code == 200
    assert me_a.json()["username"] == "user_a"
    assert me_a.json()["id"] == user_a_id

    me_b = client_b.get("/me", headers={"Authorization": f"Bearer {token_b}"})
    assert me_b.status_code == 200
    assert me_b.json()["username"] == "user_b"
    assert me_b.json()["id"] == user_b_id

    # 6. User A uploads a private document
    import docx
    from unittest.mock import patch

    def create_docx(title_text):
        doc = docx.Document()
        doc.add_heading(title_text, level=1)
        doc.add_paragraph("Research content for user private document isolation testing.")
        buf = io.BytesIO()
        doc.save(buf)
        buf.seek(0)
        return buf.getvalue()

    with patch("backend.app.ingestion.generate_embedding", return_value=[0.05] * 768), \
         patch("backend.app.retrieval.generate_embedding", return_value=[0.05] * 768):

        upload_a = client_a.post(
            "/documents",
            data={"title": "User A Private Research", "visibility": "private"},
            files={"file": ("paper_a.docx", io.BytesIO(create_docx("User A Paper")), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
            headers={"Authorization": f"Bearer {token_a}"},
        )
        assert upload_a.status_code == 201, upload_a.text
        doc_a_id = upload_a.json()["id"]

        # User B uploads a private document
        upload_b = client_b.post(
            "/documents",
            data={"title": "User B Private Research", "visibility": "private"},
            files={"file": ("paper_b.docx", io.BytesIO(create_docx("User B Paper")), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
            headers={"Authorization": f"Bearer {token_b}"},
        )
        assert upload_b.status_code == 201, upload_b.text
        doc_b_id = upload_b.json()["id"]

    # 7. Check list isolation: filter_by=mine
    docs_a = client_a.get("/documents?filter_by=mine", headers={"Authorization": f"Bearer {token_a}"}).json()
    assert len(docs_a) == 1
    assert docs_a[0]["id"] == doc_a_id

    docs_b = client_b.get("/documents?filter_by=mine", headers={"Authorization": f"Bearer {token_b}"}).json()
    assert len(docs_b) == 1
    assert docs_b[0]["id"] == doc_b_id

    # 8. Access control checks: User B cannot access User A's private resources by changing ID
    # Get metadata
    forbidden_get = client_b.get(f"/documents/{doc_a_id}", headers={"Authorization": f"Bearer {token_b}"})
    assert forbidden_get.status_code == 403

    # Download
    forbidden_dl = client_b.get(f"/documents/{doc_a_id}/download", headers={"Authorization": f"Bearer {token_b}"})
    assert forbidden_dl.status_code == 403

    # Delete
    forbidden_del = client_b.delete(f"/documents/{doc_a_id}", headers={"Authorization": f"Bearer {token_b}"})
    assert forbidden_del.status_code in (403, 404)

    # Comment
    forbidden_comment = client_b.post(
        f"/documents/{doc_a_id}/comments",
        json={"content": "Malicious comment"},
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert forbidden_comment.status_code == 403

    # Chat
    forbidden_chat = client_b.post(
        f"/documents/{doc_a_id}/chat",
        json={"question": "What is in this paper?"},
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert forbidden_chat.status_code == 403

    # 9. Logging out User A on Browser A clears User A's cookie
    logout_a = client_a.post("/logout")
    assert logout_a.status_code == 200
    # User A cannot refresh anymore
    cookie_expired_a = logout_a.headers.get("set-cookie") or ""
    assert "rp_refresh_token" in cookie_expired_a

    # 10. User B's separate session on Browser B remains completely unaffected
    me_b_still_valid = client_b.get("/me", headers={"Authorization": f"Bearer {token_b}"})
    assert me_b_still_valid.status_code == 200
    assert me_b_still_valid.json()["username"] == "user_b"

    # User B can refresh their session
    refresh_b = client_b.post("/refresh")
    assert refresh_b.status_code == 200
    new_token_b = refresh_b.json()["access_token"]
    assert new_token_b is not None

    me_b_refreshed = client_b.get("/me", headers={"Authorization": f"Bearer {new_token_b}"})
    assert me_b_refreshed.status_code == 200
    assert me_b_refreshed.json()["username"] == "user_b"

    # 11. Security check: verify that refresh tokens cannot be used as Bearer access tokens
    fake_bearer_refresh = create_refresh_token(subject=user_a_id)
    reject_refresh_as_access = client_a.get(
        "/me",
        headers={"Authorization": f"Bearer {fake_bearer_refresh}"},
    )
    assert reject_refresh_as_access.status_code == 401
    assert "could not validate credentials" in reject_refresh_as_access.json()["detail"].lower()
