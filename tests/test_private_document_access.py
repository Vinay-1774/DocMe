import io
import sys
from datetime import timedelta
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import URL, create_engine, text
from sqlalchemy.orm import sessionmaker

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from backend.app import config
from backend.app.auth import create_access_token, create_refresh_token, hash_password
from backend.app.database import Base, get_db
from backend.app.main import app
from backend.app.models import User, Document, DocumentTopic, Topic
from backend.app.storage import storage_manager

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
        session.query(DocumentTopic).delete()
        session.query(Document).delete()
        session.query(Topic).delete()
        session.query(User).delete()
        session.commit()


def test_private_document_access_permissions():
    """
    Verifies:
    1. Authenticated document owner can read private document metadata and download file.
    2. Other authenticated users receive 403 Forbidden for private documents.
    3. Signed-out users receive 401 Unauthorized for private documents.
    4. Public documents remain readable and downloadable by anyone.
    """
    # Create test storage file
    test_file_name = "test_private_doc.pdf"
    test_content = b"%PDF-1.4 test document content for private doc access"
    storage_manager.upload_dir.mkdir(parents=True, exist_ok=True)
    local_file = storage_manager.upload_dir / test_file_name
    with open(local_file, "wb") as f:
        f.write(test_content)

    with TestSessionLocal() as session:
        owner = User(
            username="docowner",
            email="owner@docme.org",
            hashed_password=hash_password("password123"),
            is_verified=True,
        )
        other_user = User(
            username="otherresearcher",
            email="other@docme.org",
            hashed_password=hash_password("password123"),
            is_verified=True,
        )
        session.add_all([owner, other_user])
        session.commit()
        session.refresh(owner)
        session.refresh(other_user)

        private_doc = Document(
            title="Private Research Note",
            description="Confidential findings",
            file_path=str(local_file),
            file_type="pdf",
            user_id=owner.id,
            visibility="private",
        )
        public_doc = Document(
            title="Public Research Paper",
            description="Open findings",
            file_path=str(local_file),
            file_type="pdf",
            user_id=owner.id,
            visibility="public",
        )
        session.add_all([private_doc, public_doc])
        session.commit()
        session.refresh(private_doc)
        session.refresh(public_doc)

        owner_id = owner.id
        other_user_id = other_user.id
        private_doc_id = private_doc.id
        public_doc_id = public_doc.id

    owner_token = create_access_token(subject=owner_id)
    other_token = create_access_token(subject=other_user_id)

    client = TestClient(app)

    # 1. Owner can read their private document metadata
    resp_owner_meta = client.get(
        f"/documents/{private_doc_id}",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert resp_owner_meta.status_code == 200
    assert resp_owner_meta.json()["id"] == private_doc_id
    assert resp_owner_meta.json()["visibility"] == "private"

    # 2. Owner can download their private document file
    resp_owner_dl = client.get(
        f"/documents/{private_doc_id}/download",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert resp_owner_dl.status_code == 200
    assert resp_owner_dl.content == test_content

    # 3. Other authenticated user cannot read owner's private document metadata
    resp_other_meta = client.get(
        f"/documents/{private_doc_id}",
        headers={"Authorization": f"Bearer {other_token}"},
    )
    assert resp_other_meta.status_code == 403
    assert "not authorized to view" in resp_other_meta.json()["detail"].lower()

    # 4. Other authenticated user cannot download owner's private document file
    resp_other_dl = client.get(
        f"/documents/{private_doc_id}/download",
        headers={"Authorization": f"Bearer {other_token}"},
    )
    assert resp_other_dl.status_code == 403
    assert "not authorized to download" in resp_other_dl.json()["detail"].lower()

    # 5. Signed-out user cannot read private document metadata
    resp_anon_meta = client.get(f"/documents/{private_doc_id}")
    assert resp_anon_meta.status_code == 401

    # 6. Signed-out user cannot download private document file
    resp_anon_dl = client.get(f"/documents/{private_doc_id}/download")
    assert resp_anon_dl.status_code == 401

    # 7. Public document is accessible by owner, other user, and signed-out visitor
    for headers in [
        {"Authorization": f"Bearer {owner_token}"},
        {"Authorization": f"Bearer {other_token}"},
        {},
    ]:
        resp_pub_meta = client.get(f"/documents/{public_doc_id}", headers=headers)
        assert resp_pub_meta.status_code == 200
        assert resp_pub_meta.json()["id"] == public_doc_id

        resp_pub_dl = client.get(f"/documents/{public_doc_id}/download", headers=headers)
        assert resp_pub_dl.status_code == 200
        assert resp_pub_dl.content == test_content


def test_expired_token_refresh_flow_for_private_document():
    """
    Verifies that an expired access token fails with 401,
    and after refreshing the token using the refresh cookie/token,
    the owner can seamlessly access their private document.
    """
    test_file_name = "test_expired_token_doc.pdf"
    test_content = b"%PDF-1.4 test expired token document"
    storage_manager.upload_dir.mkdir(parents=True, exist_ok=True)
    local_file = storage_manager.upload_dir / test_file_name
    with open(local_file, "wb") as f:
        f.write(test_content)

    with TestSessionLocal() as session:
        owner = User(
            username="sessionowner",
            email="sessionowner@docme.org",
            hashed_password=hash_password("password123"),
            is_verified=True,
        )
        session.add(owner)
        session.commit()
        session.refresh(owner)

        private_doc = Document(
            title="Private Expirable Note",
            description="Testing token refresh",
            file_path=str(local_file),
            file_type="pdf",
            user_id=owner.id,
            visibility="private",
        )
        session.add(private_doc)
        session.commit()
        session.refresh(private_doc)

        owner_id = owner.id
        doc_id = private_doc.id

    client = TestClient(app)

    # Create an already-expired access token
    expired_token = create_access_token(
        subject=owner_id,
        expires_delta=timedelta(seconds=-30),
    )
    # Create valid refresh token
    valid_refresh_token = create_refresh_token(subject=owner_id)

    # 1. Accessing private document with expired token returns 401
    resp_expired = client.get(
        f"/documents/{doc_id}",
        headers={"Authorization": f"Bearer {expired_token}"},
    )
    assert resp_expired.status_code == 401

    # 2. Refresh the token via /refresh using refresh cookie
    client.cookies.set("rp_refresh_token", valid_refresh_token)
    resp_refresh = client.post("/refresh")
    assert resp_refresh.status_code == 200
    new_access_token = resp_refresh.json()["access_token"]
    assert new_access_token is not None

    # 3. Accessing private document with refreshed token succeeds!
    resp_success = client.get(
        f"/documents/{doc_id}",
        headers={"Authorization": f"Bearer {new_access_token}"},
    )
    assert resp_success.status_code == 200
    assert resp_success.json()["id"] == doc_id
    assert resp_success.json()["title"] == "Private Expirable Note"
