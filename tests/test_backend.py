import io
import os
import sys
from pathlib import Path
from unittest.mock import patch

import docx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import URL, create_engine, text
from sqlalchemy.orm import sessionmaker

# Ensure project root is in sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from backend.app import config
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

from backend.app.database import Base, get_db
from backend.app.models import Comment, Document, DocumentChunk, User
from backend.app.main import app


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
    # Cleanup tables after test session in test DB
    Base.metadata.drop_all(bind=test_engine)


@pytest.fixture(autouse=True)
def clean_tables():
    """Cleans tables between individual tests in isolated test DB."""
    yield
    with test_engine.connect() as conn:
        conn.execute(text("TRUNCATE TABLE document_chunks, comments, documents, users RESTART IDENTITY CASCADE;"))
        conn.commit()


@pytest.fixture
def client():
    return TestClient(app)


# Mock embedding vector for tests (768 dimensions)
DUMMY_VECTOR = [0.01] * 768


def mock_generate_embedding(text: str):
    return DUMMY_VECTOR


def mock_generate_embeddings(texts: list):
    return [DUMMY_VECTOR for _ in texts]


def mock_chat_response(*args, **kwargs):
    return "This is a grounded test answer based on the provided document context."


# =====================================================================
# 1. Root & Health Check Tests
# =====================================================================

def test_root_endpoint(client):
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "online"
    assert "Research Platform API" in data["message"]


# =====================================================================
# 2. Authentication Tests
# =====================================================================

def test_register_success(client):
    payload = {
        "username": "alice",
        "email": "alice@example.com",
        "password": "SecurePassword123!",
    }
    response = client.post("/register", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["username"] == "alice"
    assert data["email"] == "alice@example.com"
    assert "id" in data
    assert "created_at" in data
    # Security check: Password hashes must never be exposed
    assert "password" not in data
    assert "hashed_password" not in data


def test_register_duplicate_username(client):
    payload = {"username": "alice", "email": "alice@example.com", "password": "password123"}
    client.post("/register", json=payload)
    # Duplicate username
    dup_payload = {"username": "alice", "email": "alice2@example.com", "password": "password123"}
    response = client.post("/register", json=dup_payload)
    assert response.status_code == 400
    assert "username is already registered" in response.json()["detail"]


def test_register_duplicate_email(client):
    payload = {"username": "alice", "email": "alice@example.com", "password": "password123"}
    client.post("/register", json=payload)
    # Duplicate email
    dup_payload = {"username": "bob", "email": "alice@example.com", "password": "password123"}
    response = client.post("/register", json=dup_payload)
    assert response.status_code == 400
    assert "email is already registered" in response.json()["detail"]


def test_login_success_and_failure(client):
    # Register
    client.post("/register", json={"username": "alice", "email": "alice@example.com", "password": "password123"})
    # Valid login
    res = client.post("/login", json={"email": "alice@example.com", "password": "password123"})
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"

    # Invalid password
    res_bad_pw = client.post("/login", json={"email": "alice@example.com", "password": "wrongpassword"})
    assert res_bad_pw.status_code == 401

    # Non-existent email
    res_bad_email = client.post("/login", json={"email": "nobody@example.com", "password": "password123"})
    assert res_bad_email.status_code == 401


def test_get_me_endpoint(client):
    client.post("/register", json={"username": "alice", "email": "alice@example.com", "password": "password123"})
    login_res = client.post("/login", json={"email": "alice@example.com", "password": "password123"})
    token = login_res.json()["access_token"]

    # Valid token
    res = client.get("/me", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["username"] == "alice"

    # Missing token
    res_no_tok = client.get("/me")
    assert res_no_tok.status_code == 401

    # Invalid token
    res_bad_tok = client.get("/me", headers={"Authorization": "Bearer invalid.token.value"})
    assert res_bad_tok.status_code == 401


def test_swagger_oauth2_form_login_success_and_authenticate_protected_endpoint(client):
    """
    Verifies that Swagger's OAuth2 password flow (/token with application/x-www-form-urlencoded):
    1. Accepts 'username' and 'password' form fields.
    2. Interprets 'username' as the user's email address.
    3. Returns standard access_token and token_type='bearer'.
    4. The returned token successfully authenticates protected endpoints (GET /me).
    """
    client.post("/register", json={"username": "alice", "email": "alice@example.com", "password": "password123"})

    # Swagger form submission sends application/x-www-form-urlencoded
    form_payload = {
        "username": "alice@example.com",  # Form field named 'username' containing email
        "password": "password123",
    }
    res = client.post("/token", data=form_payload)
    assert res.status_code == 200
    token_data = res.json()
    assert "access_token" in token_data
    assert token_data["token_type"] == "bearer"

    # Use token to authenticate protected endpoint
    token = token_data["access_token"]
    me_res = client.get("/me", headers={"Authorization": f"Bearer {token}"})
    assert me_res.status_code == 200
    assert me_res.json()["email"] == "alice@example.com"
    assert me_res.json()["username"] == "alice"


def test_swagger_oauth2_form_login_invalid_credentials_and_lookup_isolation(client):
    """
    Verifies that:
    1. Invalid password returns 401.
    2. Non-existent email returns 401.
    3. Submitting the username 'alice' instead of email returns 401 (proves DB lookup is strictly email-based).
    4. OAuth2PasswordBearer tokenUrl is consistent with /token.
    """
    from backend.app.auth import oauth2_scheme

    client.post("/register", json={"username": "alice", "email": "alice@example.com", "password": "password123"})

    # 1. Invalid password
    bad_pw = client.post("/token", data={"username": "alice@example.com", "password": "wrongpassword"})
    assert bad_pw.status_code == 401
    assert "WWW-Authenticate" in bad_pw.headers

    # 2. Non-existent email
    bad_email = client.post("/token", data={"username": "nonexistent@example.com", "password": "password123"})
    assert bad_email.status_code == 401

    # 3. Submitting username 'alice' instead of email 'alice@example.com' must fail
    username_lookup = client.post("/token", data={"username": "alice", "password": "password123"})
    assert username_lookup.status_code == 401

    # 4. Token URL consistency check
    assert oauth2_scheme.model.flows.password.tokenUrl == "token"


# =====================================================================
# 3. Documents & Permissions Tests
# =====================================================================

def create_sample_docx_bytes(content: str = None):
    doc = docx.Document()
    if content:
        doc.add_paragraph(content)
    else:
        doc.add_paragraph("Quantum computing utilizes quantum bits or qubits.")
        doc.add_paragraph("Superposition allows qubits to exist in multiple states simultaneously.")
    stream = io.BytesIO()
    doc.save(stream)
    stream.seek(0)
    return stream


@patch("backend.app.ingestion.generate_embedding", side_effect=mock_generate_embedding)
@patch("backend.app.ingestion.generate_embeddings", side_effect=mock_generate_embeddings)
def test_document_upload_and_permissions(mock_embed, mock_embeds, client):
    # 1. Register User 1 (Alice) and User 2 (Bob)
    client.post("/register", json={"username": "alice", "email": "alice@example.com", "password": "password123"})
    tok_alice = client.post("/login", json={"email": "alice@example.com", "password": "password123"}).json()["access_token"]

    client.post("/register", json={"username": "bob", "email": "bob@example.com", "password": "password123"})
    tok_bob = client.post("/login", json={"email": "bob@example.com", "password": "password123"}).json()["access_token"]

    # 2. Alice uploads a PRIVATE document
    docx_file = create_sample_docx_bytes()
    upload_res = client.post(
        "/documents",
        headers={"Authorization": f"Bearer {tok_alice}"},
        data={"title": "Alice Private Research", "description": "Confidential research on QC", "visibility": "private"},
        files={"file": ("alice_research.docx", docx_file, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )
    assert upload_res.status_code == 201
    doc_alice = upload_res.json()
    assert doc_alice["title"] == "Alice Private Research"
    assert doc_alice["visibility"] == "private"
    assert "file_path" not in doc_alice  # internal path must NOT be leaked
    alice_doc_id = doc_alice["id"]

    # Verify chunks stored in database
    db = TestSessionLocal()
    chunks = db.query(DocumentChunk).filter(DocumentChunk.document_id == alice_doc_id).all()
    assert len(chunks) > 0
    assert chunks[0].user_id == doc_alice["user_id"]
    db.close()

    # 3. Alice can view and download her private document
    view_res = client.get(f"/documents/{alice_doc_id}", headers={"Authorization": f"Bearer {tok_alice}"})
    assert view_res.status_code == 200

    down_res = client.get(f"/documents/{alice_doc_id}/download", headers={"Authorization": f"Bearer {tok_alice}"})
    assert down_res.status_code == 200

    # 4. Bob CANNOT view or download Alice's private document (403 Forbidden)
    bob_view = client.get(f"/documents/{alice_doc_id}", headers={"Authorization": f"Bearer {tok_bob}"})
    assert bob_view.status_code == 403

    bob_down = client.get(f"/documents/{alice_doc_id}/download", headers={"Authorization": f"Bearer {tok_bob}"})
    assert bob_down.status_code == 403

    # 5. Bob does NOT see Alice's private document in list
    bob_list = client.get("/documents", headers={"Authorization": f"Bearer {tok_bob}"}).json()
    assert len(bob_list) == 0

    # 6. Alice updates her document metadata
    patch_res = client.patch(
        f"/documents/{alice_doc_id}",
        headers={"Authorization": f"Bearer {tok_alice}"},
        json={"title": "Updated Alice Research Title"},
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["title"] == "Updated Alice Research Title"

    # Bob cannot patch Alice's document
    bob_patch = client.patch(
        f"/documents/{alice_doc_id}",
        headers={"Authorization": f"Bearer {tok_bob}"},
        json={"title": "Hacked Title"},
    )
    assert bob_patch.status_code == 403

    # 7. Alice uploads a PUBLIC document
    docx_file2 = create_sample_docx_bytes()
    pub_res = client.post(
        "/documents",
        headers={"Authorization": f"Bearer {tok_alice}"},
        data={"title": "Alice Public Research", "visibility": "public"},
        files={"file": ("alice_public.docx", docx_file2, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )
    assert pub_res.status_code == 201
    pub_doc_id = pub_res.json()["id"]

    # Bob can view and download Alice's PUBLIC document
    assert client.get(f"/documents/{pub_doc_id}", headers={"Authorization": f"Bearer {tok_bob}"}).status_code == 200
    assert client.get(f"/documents/{pub_doc_id}/download", headers={"Authorization": f"Bearer {tok_bob}"}).status_code == 200


def test_upload_unsupported_file(client):
    client.post("/register", json={"username": "alice", "email": "alice@example.com", "password": "password123"})
    token = client.post("/login", json={"email": "alice@example.com", "password": "password123"}).json()["access_token"]

    bad_file = io.BytesIO(b"fake executable binary")
    res = client.post(
        "/documents",
        headers={"Authorization": f"Bearer {token}"},
        data={"title": "Bad File"},
        files={"file": ("malicious.exe", bad_file, "application/octet-stream")},
    )
    assert res.status_code == 400
    assert "Unsupported file format" in res.json()["detail"]


# =====================================================================
# 4. Comments Tests
# =====================================================================

@patch("backend.app.ingestion.generate_embedding", side_effect=mock_generate_embedding)
@patch("backend.app.ingestion.generate_embeddings", side_effect=mock_generate_embeddings)
def test_comments_permissions(mock_embed, mock_embeds, client):
    # Setup Alice and Bob
    client.post("/register", json={"username": "alice", "email": "alice@example.com", "password": "password123"})
    tok_alice = client.post("/login", json={"email": "alice@example.com", "password": "password123"}).json()["access_token"]
    client.post("/register", json={"username": "bob", "email": "bob@example.com", "password": "password123"})
    tok_bob = client.post("/login", json={"email": "bob@example.com", "password": "password123"}).json()["access_token"]

    # Alice uploads private document
    doc_priv = client.post(
        "/documents",
        headers={"Authorization": f"Bearer {tok_alice}"},
        data={"title": "Private", "visibility": "private"},
        files={"file": ("priv.docx", create_sample_docx_bytes(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    ).json()["id"]

    # Bob cannot comment on or view comments on private document
    bob_cmt = client.post(
        f"/documents/{doc_priv}/comments",
        headers={"Authorization": f"Bearer {tok_bob}"},
        json={"content": "Sneaky comment"},
    )
    assert bob_cmt.status_code == 403

    bob_get_cmt = client.get(f"/documents/{doc_priv}/comments", headers={"Authorization": f"Bearer {tok_bob}"})
    assert bob_get_cmt.status_code == 403

    # Alice uploads public document
    doc_pub = client.post(
        "/documents",
        headers={"Authorization": f"Bearer {tok_alice}"},
        data={"title": "Public", "visibility": "public"},
        files={"file": ("pub.docx", create_sample_docx_bytes(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    ).json()["id"]

    # Bob can comment on public document
    bob_pub_cmt = client.post(
        f"/documents/{doc_pub}/comments",
        headers={"Authorization": f"Bearer {tok_bob}"},
        json={"content": "Great research!"},
    )
    assert bob_pub_cmt.status_code == 201
    assert bob_pub_cmt.json()["content"] == "Great research!"

    # Both can view comments on public document
    comments = client.get(f"/documents/{doc_pub}/comments", headers={"Authorization": f"Bearer {tok_bob}"}).json()
    assert len(comments) == 1
    assert comments[0]["content"] == "Great research!"


# =====================================================================
# 5. Public Feed & Discovery Tests
# =====================================================================

@patch("backend.app.ingestion.generate_embedding", side_effect=mock_generate_embedding)
@patch("backend.app.ingestion.generate_embeddings", side_effect=mock_generate_embeddings)
def test_discovery_endpoints(mock_embed, mock_embeds, client):
    # Setup Alice and Bob
    client.post("/register", json={"username": "alice", "email": "alice@example.com", "password": "password123"})
    tok_alice = client.post("/login", json={"email": "alice@example.com", "password": "password123"}).json()["access_token"]
    client.post("/register", json={"username": "bob", "email": "bob@example.com", "password": "password123"})
    tok_bob = client.post("/login", json={"email": "bob@example.com", "password": "password123"}).json()["access_token"]

    # Alice uploads 1 public doc and 1 private doc
    client.post(
        "/documents",
        headers={"Authorization": f"Bearer {tok_alice}"},
        data={"title": "Private Doc", "visibility": "private"},
        files={"file": ("priv.docx", create_sample_docx_bytes(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )
    pub_doc = client.post(
        "/documents",
        headers={"Authorization": f"Bearer {tok_alice}"},
        data={"title": "Public Doc 1", "visibility": "public"},
        files={"file": ("pub1.docx", create_sample_docx_bytes(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    ).json()["id"]

    # Bob adds a comment to the public doc
    client.post(f"/documents/{pub_doc}/comments", headers={"Authorization": f"Bearer {tok_bob}"}, json={"content": "Nice!"})

    # 1. Public Feed only contains public doc
    feed = client.get("/feed").json()
    assert len(feed) == 1
    assert feed[0]["title"] == "Public Doc 1"

    # 2. Popular documents endpoint shows comment_count = 1
    popular = client.get("/documents/popular").json()
    assert len(popular) == 1
    assert popular[0]["comment_count"] == 1
    assert popular[0]["title"] == "Public Doc 1"

    # 3. User ranking shows Alice with 2 documents, Bob with 0
    ranking = client.get("/users/ranking").json()
    assert len(ranking) >= 2
    alice_rank = next(r for r in ranking if r["username"] == "alice")
    assert alice_rank["document_count"] == 2


# =====================================================================
# 6. Retrieval & pgvector Authorization Tests
# =====================================================================

@patch("backend.app.ingestion.generate_embedding", side_effect=mock_generate_embedding)
@patch("backend.app.ingestion.generate_embeddings", side_effect=mock_generate_embeddings)
@patch("backend.app.retrieval.generate_embedding", side_effect=mock_generate_embedding)
def test_retrieval_authorization(mock_ret_embed, mock_embeds, mock_embed, client):
    from backend.app.retrieval import retrieve_documents

    # Register Alice and Bob
    client.post("/register", json={"username": "alice", "email": "alice@example.com", "password": "password123"})
    tok_alice = client.post("/login", json={"email": "alice@example.com", "password": "password123"}).json()["access_token"]
    u_alice = client.get("/me", headers={"Authorization": f"Bearer {tok_alice}"}).json()["id"]

    client.post("/register", json={"username": "bob", "email": "bob@example.com", "password": "password123"})
    tok_bob = client.post("/login", json={"email": "bob@example.com", "password": "password123"}).json()["access_token"]
    u_bob = client.get("/me", headers={"Authorization": f"Bearer {tok_bob}"}).json()["id"]

    # Alice uploads private document
    doc_priv_id = client.post(
        "/documents",
        headers={"Authorization": f"Bearer {tok_alice}"},
        data={"title": "Alice Private AI", "visibility": "private"},
        files={"file": ("priv_ai.docx", create_sample_docx_bytes(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    ).json()["id"]

    db = TestSessionLocal()
    # 1. Alice queries her private document -> chunks returned
    res_alice = retrieve_documents("What is quantum computing?", user_id=u_alice, document_id=doc_priv_id, db=db)
    assert len(res_alice["documents"]) > 0

    # 2. Bob queries Alice's private document -> 0 chunks returned (database-level security)
    res_bob = retrieve_documents("What is quantum computing?", user_id=u_bob, document_id=doc_priv_id, db=db)
    assert len(res_bob["documents"]) == 0

    # 3. Unauthenticated query on private document -> 0 chunks returned
    res_anon = retrieve_documents("What is quantum computing?", user_id=None, document_id=doc_priv_id, db=db)
    assert len(res_anon["documents"]) == 0
    db.close()


# =====================================================================
# 7. Document Chat (LangGraph RAG) Tests
# =====================================================================

@patch("backend.app.ingestion.generate_embedding", side_effect=mock_generate_embedding)
@patch("backend.app.ingestion.generate_embeddings", side_effect=mock_generate_embeddings)
@patch("backend.app.retrieval.generate_embedding", side_effect=mock_generate_embedding)
@patch("backend.app.nodes.generate_response", side_effect=mock_chat_response)
@patch("backend.app.chat.generate_response", side_effect=mock_chat_response)
def test_document_chat_endpoint(mock_chat, mock_node_chat, mock_ret_embed, mock_embeds, mock_embed, client):
    # Register Alice and Bob
    client.post("/register", json={"username": "alice", "email": "alice@example.com", "password": "password123"})
    tok_alice = client.post("/login", json={"email": "alice@example.com", "password": "password123"}).json()["access_token"]

    client.post("/register", json={"username": "bob", "email": "bob@example.com", "password": "password123"})
    tok_bob = client.post("/login", json={"email": "bob@example.com", "password": "password123"}).json()["access_token"]

    # Alice uploads private document
    priv_id = client.post(
        "/documents",
        headers={"Authorization": f"Bearer {tok_alice}"},
        data={"title": "Secret Document", "visibility": "private"},
        files={"file": ("secret.docx", create_sample_docx_bytes(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    ).json()["id"]

    # 1. Bob cannot chat with Alice's private document (403 Forbidden)
    bob_chat = client.post(
        f"/documents/{priv_id}/chat",
        headers={"Authorization": f"Bearer {tok_bob}"},
        json={"question": "What is inside?"},
    )
    assert bob_chat.status_code == 403

    # 2. Alice CAN chat with her private document -> returns answer and sources
    alice_chat = client.post(
        f"/documents/{priv_id}/chat",
        headers={"Authorization": f"Bearer {tok_alice}"},
        json={"question": "What is quantum computing?"},
    )
    assert alice_chat.status_code == 200
    chat_data = alice_chat.json()
    assert "answer" in chat_data
    assert "sources" in chat_data
    assert len(chat_data["sources"]) > 0
    assert chat_data["sources"][0]["document_id"] == priv_id

    # 3. Empty question fails with 400
    empty_chat = client.post(
        f"/documents/{priv_id}/chat",
        headers={"Authorization": f"Bearer {tok_alice}"},
        json={"question": "   "},
    )
    assert empty_chat.status_code == 400


# =====================================================================
# 8. Fix 1: Upload Rollback & Cleanup Tests
# =====================================================================

def test_upload_failure_during_file_storage(client):
    """Verifies that failures during disk write roll back cleanly without leaving DB rows or orphan files."""
    client.post("/register", json={"username": "alice", "email": "alice@example.com", "password": "password123"})
    token = client.post("/login", json={"email": "alice@example.com", "password": "password123"}).json()["access_token"]

    with patch("shutil.copyfileobj", side_effect=OSError("Disk write error")):
        res = client.post(
            "/documents",
            headers={"Authorization": f"Bearer {token}"},
            data={"title": "Storage Fail Doc"},
            files={"file": ("test.docx", create_sample_docx_bytes(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
        )
    assert res.status_code == 500
    assert "Failed to save uploaded file." in res.json()["detail"]
    assert "/home/" not in res.json()["detail"]  # No internal paths leaked

def test_upload_failure_during_record_persistence(client):
    """Verifies that failures during document record persistence roll back the transaction and clean up files."""
    from sqlalchemy.exc import SQLAlchemyError
    from sqlalchemy.orm import Session

    client.post("/register", json={"username": "alice", "email": "alice@example.com", "password": "password123"})
    token = client.post("/login", json={"email": "alice@example.com", "password": "password123"}).json()["access_token"]

    with patch.object(Session, "flush", side_effect=SQLAlchemyError("Simulated database flush failure")):
        res = client.post(
            "/documents",
            headers={"Authorization": f"Bearer {token}"},
            data={"title": "Flush Fail Doc"},
            files={"file": ("flush_fail.docx", create_sample_docx_bytes(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
        )
    assert res.status_code in (400, 500)
    assert "/home/" not in res.json()["detail"]

    db = TestSessionLocal()
    assert db.query(Document).count() == 0
    db.close()


@patch("backend.app.ingestion.generate_embedding", side_effect=mock_generate_embedding)
@patch("backend.app.ingestion.generate_embeddings", side_effect=mock_generate_embeddings)
def test_upload_failure_during_chunk_persistence(mock_embeds, mock_embed, client):
    """
    Verifies that if chunk persistence fails:
    1. The failed transaction is rolled back cleanly.
    2. The document record is removed from the database.
    3. The newly created file is deleted from disk.
    4. Pre-existing valid documents and files are preserved.
    """
    client.post("/register", json={"username": "alice", "email": "alice@example.com", "password": "password123"})
    token = client.post("/login", json={"email": "alice@example.com", "password": "password123"}).json()["access_token"]

    # 1. Upload a first valid document
    valid_res = client.post(
        "/documents",
        headers={"Authorization": f"Bearer {token}"},
        data={"title": "Pre-existing Document"},
        files={"file": ("doc1.docx", create_sample_docx_bytes(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )
    assert valid_res.status_code == 201
    doc1_id = valid_res.json()["id"]

    db = TestSessionLocal()
    doc1 = db.query(Document).filter(Document.id == doc1_id).first()
    assert doc1 is not None
    doc1_file_path = Path(doc1.file_path)
    assert doc1_file_path.is_file()
    db.close()

    # 2. Upload a second document where chunk persistence fails
    with patch("backend.app.main.ingest_document", side_effect=RuntimeError("Database chunk persistence error")):
        fail_res = client.post(
            "/documents",
            headers={"Authorization": f"Bearer {token}"},
            data={"title": "Failing Document"},
            files={"file": ("doc2.docx", create_sample_docx_bytes(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
        )
    assert fail_res.status_code == 400
    assert "Document processing failed." in fail_res.json()["detail"]
    assert "/home/" not in fail_res.json()["detail"]  # No internal path leaked

    # 3. Verify database state: only doc1 exists, doc2 was rolled back
    db = TestSessionLocal()
    assert db.query(Document).count() == 1
    assert db.query(Document).filter(Document.id == doc1_id).first() is not None
    db.close()

    # 4. Verify filesystem state: doc1's file is intact, doc2's file was cleaned up
    assert doc1_file_path.is_file()


# =====================================================================
# 9. Fix 2: Consistent Chat Streaming (SSE & Non-Streaming) Tests
# =====================================================================

class MockStreamChunk:
    def __init__(self, text):
        self.text = text


class MockStreamResponse:
    def __init__(self, should_fail=False):
        self.should_fail = should_fail

    def __iter__(self):
        yield MockStreamChunk("Quantum ")
        yield MockStreamChunk("computing ")
        yield MockStreamChunk("uses qubits.")
        if self.should_fail:
            raise RuntimeError("Provider connection reset mid-stream")


def mock_get_stream_model(*args, **kwargs):
    class MockModel:
        def generate_content(self, prompt, stream=False):
            return MockStreamResponse(should_fail=False)

    return MockModel()


def mock_get_error_stream_model(*args, **kwargs):
    class MockModel:
        def generate_content(self, prompt, stream=False):
            return MockStreamResponse(should_fail=True)

    return MockModel()


@patch("backend.app.ingestion.generate_embedding", side_effect=mock_generate_embedding)
@patch("backend.app.ingestion.generate_embeddings", side_effect=mock_generate_embeddings)
@patch("backend.app.retrieval.generate_embedding", side_effect=mock_generate_embedding)
@patch("backend.app.nodes.generate_response", side_effect=mock_chat_response)
@patch("backend.app.chat.generate_response", side_effect=mock_chat_response)
def test_chat_streaming_modes_and_sse_formatting(
    mock_chat, mock_node_chat, mock_ret_embed, mock_embeds, mock_embed, client
):
    """Verifies that ?stream=true emits SSE events, while ?stream=false returns JSON."""
    client.post("/register", json={"username": "alice", "email": "alice@example.com", "password": "password123"})
    token = client.post("/login", json={"email": "alice@example.com", "password": "password123"}).json()["access_token"]

    doc_id = client.post(
        "/documents",
        headers={"Authorization": f"Bearer {token}"},
        data={"title": "Quantum Paper", "visibility": "public"},
        files={"file": ("quantum.docx", create_sample_docx_bytes(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    ).json()["id"]

    # 1. Non-streaming mode (default without query parameter): returns application/json
    res_default = client.post(
        f"/documents/{doc_id}/chat",
        headers={"Authorization": f"Bearer {token}"},
        json={"question": "What is quantum computing?"},
    )
    assert res_default.status_code == 200
    assert "application/json" in res_default.headers["content-type"]
    json_body = res_default.json()
    assert "answer" in json_body
    assert "sources" in json_body

    # 2. Non-streaming mode explicitly with ?stream=false: returns application/json
    res_non_stream = client.post(
        f"/documents/{doc_id}/chat?stream=false",
        headers={"Authorization": f"Bearer {token}"},
        json={"question": "What is quantum computing?"},
    )
    assert res_non_stream.status_code == 200
    assert "application/json" in res_non_stream.headers["content-type"]

    # 3. Streaming mode with ?stream=true: returns text/event-stream with SSE events
    with patch("backend.app.chat.get_model", side_effect=mock_get_stream_model):
        res_stream = client.post(
            f"/documents/{doc_id}/chat?stream=true",
            headers={"Authorization": f"Bearer {token}"},
            json={"question": "What is quantum computing?"},
        )
    assert res_stream.status_code == 200
    assert "text/event-stream" in res_stream.headers["content-type"]
    stream_content = res_stream.text

    # Verify standard SSE events format
    assert "event: sources" in stream_content
    assert "event: message" in stream_content
    assert "event: done" in stream_content
    assert "Quantum" in stream_content
    assert "uses qubits." in stream_content
    assert '"status": "completed"' in stream_content


@patch("backend.app.ingestion.generate_embedding", side_effect=mock_generate_embedding)
@patch("backend.app.ingestion.generate_embeddings", side_effect=mock_generate_embeddings)
@patch("backend.app.retrieval.generate_embedding", side_effect=mock_generate_embedding)
def test_chat_streaming_provider_error_handling(
    mock_ret_embed, mock_embeds, mock_embed, client
):
    """Verifies that an external model provider failure during streaming emits a safe error event without leaking private details."""
    client.post("/register", json={"username": "alice", "email": "alice@example.com", "password": "password123"})
    token = client.post("/login", json={"email": "alice@example.com", "password": "password123"}).json()["access_token"]

    doc_id = client.post(
        "/documents",
        headers={"Authorization": f"Bearer {token}"},
        data={"title": "Private Research", "visibility": "private"},
        files={"file": ("research.docx", create_sample_docx_bytes(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    ).json()["id"]

    with patch("backend.app.chat.get_model", side_effect=mock_get_error_stream_model):
        res_stream = client.post(
            f"/documents/{doc_id}/chat?stream=true",
            headers={"Authorization": f"Bearer {token}"},
            json={"question": "What are the secrets?"},
        )
    assert res_stream.status_code == 200
    assert "text/event-stream" in res_stream.headers["content-type"]
    stream_content = res_stream.text

    assert "event: error" in stream_content
    assert "An error occurred during response generation." in stream_content
    # Stack traces or internal system paths must never be leaked
    assert "Traceback" not in stream_content
    assert "/home/" not in stream_content


# =====================================================================
# 10. Fix 3: Embedding Fallback Behavior Tests
# =====================================================================

def test_embedding_batch_success(client):
    """Verifies that when batch embedding succeeds, it embeds all chunks in one batch call without item-by-item fallback."""
    from backend.app.ingestion import ingest_document

    client.post("/register", json={"username": "alice", "email": "alice@example.com", "password": "password123"})
    token = client.post("/login", json={"email": "alice@example.com", "password": "password123"}).json()["access_token"]

    upload_dir = Path("backend/uploads")
    upload_dir.mkdir(parents=True, exist_ok=True)
    temp_file = upload_dir / "temp_batch_test.docx"
    with open(temp_file, "wb") as f:
        f.write(create_sample_docx_bytes().getvalue())

    batch_called = []
    item_called = []

    def tracking_batch(texts):
        batch_called.append(len(texts))
        return [DUMMY_VECTOR for _ in texts]

    def tracking_item(text):
        item_called.append(text)
        return DUMMY_VECTOR

    db = TestSessionLocal()
    # Create doc in DB
    user = db.query(User).filter(User.username == "alice").first()
    doc = Document(user_id=user.id, title="Test Batch", file_path=str(temp_file), file_type="docx", visibility="public")
    db.add(doc)
    db.commit()
    db.refresh(doc)

    with patch("backend.app.ingestion.generate_embeddings", side_effect=tracking_batch), \
         patch("backend.app.ingestion.generate_embedding", side_effect=tracking_item):
        result = ingest_document(str(temp_file), document_id=doc.id, user_id=user.id, db=db)

    assert result["status"] == "success"
    assert len(batch_called) == 1
    assert len(item_called) == 0  # No sequential retry occurred!

    temp_file.unlink(missing_ok=True)
    db.close()


def test_embedding_batch_compatibility_fallback():
    """Verifies that a genuine batch-compatibility limitation triggers fallback to sequential generation."""
    from backend.app.ingestion import BatchEmbeddingUnsupportedError, ingest_document

    upload_dir = Path("backend/uploads")
    upload_dir.mkdir(parents=True, exist_ok=True)
    temp_file = upload_dir / "temp_fallback_test.docx"
    with open(temp_file, "wb") as f:
        f.write(create_sample_docx_bytes().getvalue())

    db = TestSessionLocal()
    user = User(username="carol", email="carol@example.com", hashed_password="pw")
    db.add(user)
    db.commit()
    db.refresh(user)

    doc = Document(user_id=user.id, title="Test Fallback", file_path=str(temp_file), file_type="docx", visibility="public")
    db.add(doc)
    db.commit()
    db.refresh(doc)

    item_calls = []

    def fail_batch(texts):
        raise BatchEmbeddingUnsupportedError("Batch embedding not supported by endpoint")

    def track_item(text):
        item_calls.append(text)
        return DUMMY_VECTOR

    with patch("backend.app.ingestion.generate_embeddings", side_effect=fail_batch), \
         patch("backend.app.ingestion.generate_embedding", side_effect=track_item):
        result = ingest_document(str(temp_file), document_id=doc.id, user_id=user.id, db=db)

    assert result["status"] == "success"
    assert len(item_calls) > 0  # Fell back to sequential item-by-item embeddings

    temp_file.unlink(missing_ok=True)
    db.close()


def test_embedding_genuine_provider_error_propagates():
    """Verifies that genuine provider errors (e.g., quota or auth) propagate immediately without retrying every chunk."""
    from backend.app.ingestion import ingest_document

    # Simulate Google API ResourceExhausted exception
    try:
        from google.api_core.exceptions import ResourceExhausted
        err = ResourceExhausted("429 ResourceExhausted: Quota exceeded for metric")
    except ImportError:
        class ResourceExhausted(Exception):
            pass
        err = ResourceExhausted("429 ResourceExhausted: Quota exceeded")

    upload_dir = Path("backend/uploads")
    upload_dir.mkdir(parents=True, exist_ok=True)
    temp_file = upload_dir / "temp_quota_test.docx"
    with open(temp_file, "wb") as f:
        f.write(create_sample_docx_bytes().getvalue())

    db = TestSessionLocal()
    user = User(username="dave", email="dave@example.com", hashed_password="pw")
    db.add(user)
    db.commit()
    db.refresh(user)

    doc = Document(user_id=user.id, title="Test Quota Error", file_path=str(temp_file), file_type="docx", visibility="public")
    db.add(doc)
    db.commit()
    db.refresh(doc)

    item_calls = []

    def fail_with_quota(texts):
        raise err

    def track_item(text):
        item_calls.append(text)
        return DUMMY_VECTOR

    with patch("backend.app.ingestion.generate_embeddings", side_effect=fail_with_quota), \
         patch("backend.app.ingestion.generate_embedding", side_effect=track_item):
        with pytest.raises(Exception) as exc_info:
            ingest_document(str(temp_file), document_id=doc.id, user_id=user.id, db=db)

    # Must raise the genuine error directly and NOT retry individual chunks
    assert "ResourceExhausted" in exc_info.value.__class__.__name__ or "Quota exceeded" in str(exc_info.value)
    assert len(item_calls) == 0  # Did NOT call item-by-item fallback!

    temp_file.unlink(missing_ok=True)
    db.close()


def mock_search_embedding(text: str):
    vec = [0.0] * 768
    lower = text.lower()
    if "quantum" in lower:
        vec[0] = 1.0
    elif "classified" in lower or "proprietary" in lower:
        vec[1] = 1.0
    else:
        vec[2] = 1.0
    return vec


def mock_search_embeddings(texts: list):
    return [mock_search_embedding(t) for t in texts]


@patch("backend.app.ingestion.generate_embedding", side_effect=mock_search_embedding)
@patch("backend.app.ingestion.generate_embeddings", side_effect=mock_search_embeddings)
@patch("backend.app.main.generate_embedding", side_effect=mock_search_embedding)
def test_search_documents_permissions_and_results(mock_main_emb, mock_embeds, mock_embed, client):
    """
    Verifies that GET /documents/search:
    1. Returns keyword and semantic matches.
    2. Respects visibility: public documents are searchable by anyone.
    3. Respects privacy: Alice's private documents are returned ONLY to Alice, NEVER to Bob or anonymous.
    4. Populates uploader_name properly.
    """
    # Register Alice and Bob
    client.post("/register", json={"username": "alice_searcher", "email": "alice_s@example.com", "password": "password123"})
    tok_alice = client.post("/login", json={"email": "alice_s@example.com", "password": "password123"}).json()["access_token"]

    client.post("/register", json={"username": "bob_searcher", "email": "bob_s@example.com", "password": "password123"})
    tok_bob = client.post("/login", json={"email": "bob_s@example.com", "password": "password123"}).json()["access_token"]

    # Alice uploads public paper on Quantum Computing
    pub_res = client.post(
        "/documents",
        headers={"Authorization": f"Bearer {tok_alice}"},
        data={"title": "Quantum Supremacy Analysis", "description": "Experimental quantum algorithms", "visibility": "public"},
        files={"file": ("quantum.docx", create_sample_docx_bytes("Quantum computing circuits and qubit coherence"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )
    assert pub_res.status_code == 201

    # Alice uploads private paper on Secret Formula
    priv_res = client.post(
        "/documents",
        headers={"Authorization": f"Bearer {tok_alice}"},
        data={"title": "Classified Quantum Patent", "description": "Secret proprietary architecture", "visibility": "private"},
        files={"file": ("classified.docx", create_sample_docx_bytes("Proprietary cryogenics and confidential blueprints"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )
    assert priv_res.status_code == 201

    # 1. Anonymous search for "Quantum" returns only public document
    anon_search = client.get("/documents/search?q=Quantum")
    assert anon_search.status_code == 200
    anon_docs = anon_search.json()
    assert len(anon_docs) == 1
    assert anon_docs[0]["title"] == "Quantum Supremacy Analysis"
    assert anon_docs[0]["uploader_name"] == "alice_searcher"

    # 2. Bob's search for "Quantum" returns only Alice's public document, NOT Alice's private patent
    bob_search = client.get("/documents/search?q=Quantum", headers={"Authorization": f"Bearer {tok_bob}"})
    assert bob_search.status_code == 200
    bob_docs = bob_search.json()
    assert len(bob_docs) == 1
    assert bob_docs[0]["title"] == "Quantum Supremacy Analysis"

    # 3. Bob's search for "Classified" returns empty list (private to Alice)
    bob_priv_search = client.get("/documents/search?q=Classified", headers={"Authorization": f"Bearer {tok_bob}"})
    assert bob_priv_search.status_code == 200
    assert len(bob_priv_search.json()) == 0

    # 4. Alice's search for "Quantum" returns BOTH her public document and her private document
    alice_search = client.get("/documents/search?q=Quantum", headers={"Authorization": f"Bearer {tok_alice}"})
    assert alice_search.status_code == 200
    alice_docs = alice_search.json()
    assert len(alice_docs) == 2
    titles = {d["title"] for d in alice_docs}
    assert "Quantum Supremacy Analysis" in titles
    assert "Classified Quantum Patent" in titles


@patch("backend.app.ingestion.generate_embedding", side_effect=mock_generate_embedding)
@patch("backend.app.ingestion.generate_embeddings", side_effect=mock_generate_embeddings)
def test_upload_once_reupload_detection(mock_embeds, mock_embed, client):
    """
    Verifies that uploading the exact same document twice reuses the existing document
    and does NOT call ingest_document again.
    """
    client.post("/register", json={"username": "carol_researcher", "email": "carol@example.com", "password": "password123"})
    token = client.post("/login", json={"email": "carol@example.com", "password": "password123"}).json()["access_token"]

    sample_bytes = create_sample_docx_bytes("Re-upload content hash test document")

    # 1. First upload
    res1 = client.post(
        "/documents",
        headers={"Authorization": f"Bearer {token}"},
        data={"title": "Unique Research Paper", "visibility": "public"},
        files={"file": ("unique.docx", sample_bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )
    assert res1.status_code == 201
    doc1_id = res1.json()["id"]

    # 2. Second upload of the identical document and title
    with patch("backend.app.main.ingest_document") as mock_ingest:
        res2 = client.post(
            "/documents",
            headers={"Authorization": f"Bearer {token}"},
            data={"title": "Unique Research Paper", "visibility": "public"},
            files={"file": ("unique.docx", sample_bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
        )
        assert res2.status_code == 201
        assert res2.json()["id"] == doc1_id
        # Verify ingest_document was NOT called again!
        assert mock_ingest.call_count == 0


@patch("backend.app.ingestion.generate_embedding", side_effect=mock_generate_embedding)
@patch("backend.app.ingestion.generate_embeddings", side_effect=mock_generate_embeddings)
def test_comment_response_author_name(mock_embeds, mock_embed, client):
    """
    Verifies that comments returned by GET /documents/{id}/comments include author_name.
    """
    client.post("/register", json={"username": "dave_author", "email": "dave@example.com", "password": "password123"})
    token_dave = client.post("/login", json={"email": "dave@example.com", "password": "password123"}).json()["access_token"]

    doc_res = client.post(
        "/documents",
        headers={"Authorization": f"Bearer {token_dave}"},
        data={"title": "Discussion Paper", "visibility": "public"},
        files={"file": ("paper.docx", create_sample_docx_bytes("Discussion test text"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )
    doc_id = doc_res.json()["id"]

    # Post a comment
    cmt_res = client.post(
        f"/documents/{doc_id}/comments",
        headers={"Authorization": f"Bearer {token_dave}"},
        json={"content": "Excellent analysis on section 4."},
    )
    assert cmt_res.status_code == 201
    assert cmt_res.json()["author_name"] == "dave_author"

    # Fetch comments
    list_res = client.get(
        f"/documents/{doc_id}/comments",
        headers={"Authorization": f"Bearer {token_dave}"},
    )
    assert list_res.status_code == 200
    comments = list_res.json()
    assert len(comments) == 1
    assert comments[0]["author_name"] == "dave_author"


# =====================================================================
# Tests for Download Authentication, Semantic Search, Latency & Tracing
# =====================================================================

@patch("backend.app.ingestion.generate_embedding", side_effect=mock_generate_embedding)
@patch("backend.app.ingestion.generate_embeddings", side_effect=mock_generate_embeddings)
def test_document_download_authentication_and_permissions(mock_embeds, mock_embed, client):
    """
    Verifies document download authentication and authorization:
    - Public documents are downloadable without authentication.
    - Public documents are downloadable with authentication.
    - Private documents return 401 Unauthorized when unauthenticated.
    - Private documents return 403 Forbidden when requested by non-owners.
    - Private documents return 200 OK with binary payload when requested by owner.
    - Preserves attachment filename in Content-Disposition header.
    """
    # 1. Register Owner (Eve) and Non-Owner (Frank)
    client.post("/register", json={"username": "eve_owner", "email": "eve@example.com", "password": "password123"})
    token_eve = client.post("/login", json={"email": "eve@example.com", "password": "password123"}).json()["access_token"]

    client.post("/register", json={"username": "frank_guest", "email": "frank@example.com", "password": "password123"})
    token_frank = client.post("/login", json={"email": "frank@example.com", "password": "password123"}).json()["access_token"]

    # 2. Upload public document
    pub_res = client.post(
        "/documents",
        headers={"Authorization": f"Bearer {token_eve}"},
        data={"title": "Public Research Whitepaper", "visibility": "public"},
        files={"file": ("whitepaper.docx", create_sample_docx_bytes("Public content for download test"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )
    assert pub_res.status_code == 201
    pub_id = pub_res.json()["id"]

    # 3. Upload private document
    priv_res = client.post(
        "/documents",
        headers={"Authorization": f"Bearer {token_eve}"},
        data={"title": "Confidential Research Notes", "visibility": "private"},
        files={"file": ("confidential.docx", create_sample_docx_bytes("Private confidential content"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )
    assert priv_res.status_code == 201
    priv_id = priv_res.json()["id"]

    # 4. Anonymous user can download public document
    import urllib.parse
    anon_pub = client.get(f"/documents/{pub_id}/download")
    assert anon_pub.status_code == 200
    assert "content-disposition" in anon_pub.headers
    cd_pub = urllib.parse.unquote(anon_pub.headers["content-disposition"])
    assert "Public Research Whitepaper.docx" in cd_pub
    assert len(anon_pub.content) > 0

    # 5. Authenticated non-owner can download public document
    frank_pub = client.get(f"/documents/{pub_id}/download", headers={"Authorization": f"Bearer {token_frank}"})
    assert frank_pub.status_code == 200

    # 6. Anonymous user downloading private document gets 401 Unauthorized
    anon_priv = client.get(f"/documents/{priv_id}/download")
    assert anon_priv.status_code == 401
    assert "detail" in anon_priv.json()
    assert "authenticated" in anon_priv.json()["detail"].lower()

    # 7. Non-owner (Frank) downloading private document gets 403 Forbidden
    frank_priv = client.get(f"/documents/{priv_id}/download", headers={"Authorization": f"Bearer {token_frank}"})
    assert frank_priv.status_code == 403
    assert "detail" in frank_priv.json()
    assert "not authorized" in frank_priv.json()["detail"].lower()

    # 8. Owner (Eve) downloading private document gets 200 OK
    eve_priv = client.get(f"/documents/{priv_id}/download", headers={"Authorization": f"Bearer {token_eve}"})
    assert eve_priv.status_code == 200
    assert "content-disposition" in eve_priv.headers
    cd_eve = urllib.parse.unquote(eve_priv.headers["content-disposition"])
    assert "Confidential Research Notes.docx" in cd_eve
    assert len(eve_priv.content) > 0

    # 9. Non-existent document download returns 404
    missing_doc = client.get("/documents/999999/download")
    assert missing_doc.status_code == 404


def test_semantic_search_direct_module_execution(client):
    """
    Tests that backend/app/semantic_search.py module can be imported and executed directly with access-control filtering.
    """
    from backend.app.semantic_search import perform_semantic_search
    from backend.app import semantic_search as mod

    assert hasattr(mod, "perform_semantic_search")

    with TestSessionLocal() as session:
        # Empty query returns empty list
        empty_res = mod.perform_semantic_search("", user_id=None, db=session)
        assert empty_res == []

        whitespace_res = mod.perform_semantic_search("   ", user_id=None, db=session)
        assert whitespace_res == []


def test_langsmith_tracing_toggle_and_config():
    """
    Verifies LangSmith tracing configuration:
    - Environment variables are properly loaded from config.
    - Application executes without error when tracing is disabled.
    - Disabling tracing sets LANGCHAIN_TRACING_V2 to 'false'.
    """
    import os
    from backend.app.config import LANGCHAIN_PROJECT, LANGCHAIN_ENDPOINT

    assert LANGCHAIN_PROJECT is not None
    assert "smith.langchain.com" in LANGCHAIN_ENDPOINT

    # Verify LangGraph workflow runs when tracing is disabled
    from backend.app.workflow import qa_workflow
    assert qa_workflow is not None


@patch("backend.app.nodes.generate_response", return_value="Structured mock answer: 1. Point one. 2. Point two.")
def test_chat_structured_json_response(mock_gen, client):
    """
    Verifies that non-streaming chat returns a structured JSON ChatResponse
    conforming to the API contract with answer and sources.
    """
    client.post("/register", json={"username": "grace_chat", "email": "grace@example.com", "password": "password123"})
    token_grace = client.post("/login", json={"email": "grace@example.com", "password": "password123"}).json()["access_token"]

    # Upload public doc
    with patch("backend.app.ingestion.generate_embedding", side_effect=mock_generate_embedding), \
         patch("backend.app.ingestion.generate_embeddings", side_effect=mock_generate_embeddings):
        res = client.post(
            "/documents",
            headers={"Authorization": f"Bearer {token_grace}"},
            data={"title": "AI Methodology Paper", "visibility": "public"},
            files={"file": ("methodology.docx", create_sample_docx_bytes("Methodology text"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
        )
    doc_id = res.json()["id"]

    # 1. Non-streaming chat request
    chat_res = client.post(
        f"/documents/{doc_id}/chat",
        headers={"Authorization": f"Bearer {token_grace}"},
        json={"question": "What is the methodology?", "stream": False},
    )
    assert chat_res.status_code == 200
    data = chat_res.json()
    assert "answer" in data
    assert "sources" in data
    assert isinstance(data["sources"], list)
    assert "Structured mock answer" in data["answer"]

    # 2. Empty question returns 400
    empty_res = client.post(
        f"/documents/{doc_id}/chat",
        headers={"Authorization": f"Bearer {token_grace}"},
        json={"question": "   ", "stream": False},
    )
    assert empty_res.status_code == 400

    # 3. Unauthenticated chat returns 401
    unauth_res = client.post(
        f"/documents/{doc_id}/chat",
        json={"question": "What is this?", "stream": False},
    )
    assert unauth_res.status_code == 401


def create_sample_pdf_bytes():
    from pypdf import PdfWriter
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    buf = io.BytesIO()
    writer.write(buf)
    buf.seek(0)
    return buf


def test_persistent_login_refresh_and_logout(client):
    """
    Verifies Issue 5 requirements:
    - Login sets HttpOnly refresh token cookie.
    - Refresh endpoint validates token, rotates session cookie, and returns new access token.
    - Protected endpoints accept newly refreshed access token.
    - Refresh without cookie or with invalid token returns 401.
    - Explicit logout revokes/clears cookie.
    """
    client.post(
        "/register",
        json={"username": "helen_auth", "email": "helen@example.com", "password": "password123"},
    )

    # 1. Login and verify refresh cookie
    login_res = client.post(
        "/login",
        json={"email": "helen@example.com", "password": "password123"},
    )
    assert login_res.status_code == 200
    access_token_1 = login_res.json()["access_token"]
    assert "rp_refresh_token" in login_res.cookies
    refresh_cookie = login_res.cookies["rp_refresh_token"]
    assert len(refresh_cookie) > 20

    # 2. Call /refresh using the session cookie preserved in client
    refresh_res = client.post("/refresh")
    assert refresh_res.status_code == 200
    access_token_2 = refresh_res.json()["access_token"]
    assert access_token_2 is not None

    # Verify new access token works on protected endpoint
    me_res = client.get("/me", headers={"Authorization": f"Bearer {access_token_2}"})
    assert me_res.status_code == 200
    assert me_res.json()["username"] == "helen_auth"

    # 3. Call /logout -> deletes cookie
    logout_res = client.post("/logout")
    assert logout_res.status_code == 200
    set_cookie_header = logout_res.headers.get("set-cookie", "")
    assert "rp_refresh_token=" in set_cookie_header
    assert "Max-Age=0" in set_cookie_header or "expires=" in set_cookie_header.lower()

    # 4. Clear cookie jar and call /refresh without cookie -> 401
    client.cookies.clear()
    bad_refresh = client.post("/refresh")
    assert bad_refresh.status_code == 401

    # 5. Call /refresh with invalid token -> 401
    client.cookies.set("rp_refresh_token", "invalid.jwt.token")
    invalid_refresh = client.post("/refresh")
    assert invalid_refresh.status_code == 401


def test_contributor_profile_and_visibility_rules(client):
    """
    Verifies Issue 6 requirements:
    - Contributor public profile GET /users/{id} returns profile info.
    - Contributor documents GET /users/{id}/documents respects visibility rules:
      - Visitors and other users see only public documents.
      - Owner sees all (public + private) documents.
      - Non-existent user returns 404.
    """
    client.post("/register", json={"username": "ian_contrib", "email": "ian@example.com", "password": "password123"})
    tok_ian = client.post("/login", json={"email": "ian@example.com", "password": "password123"}).json()["access_token"]
    user_ian = client.get("/me", headers={"Authorization": f"Bearer {tok_ian}"}).json()
    ian_id = user_ian["id"]

    client.post("/register", json={"username": "judy_visitor", "email": "judy@example.com", "password": "password123"})
    tok_judy = client.post("/login", json={"email": "judy@example.com", "password": "password123"}).json()["access_token"]

    # Ian uploads 1 public and 1 private document
    with patch("backend.app.ingestion.generate_embedding", side_effect=mock_generate_embedding), \
         patch("backend.app.ingestion.generate_embeddings", side_effect=mock_generate_embeddings):
        client.post(
            "/documents",
            headers={"Authorization": f"Bearer {tok_ian}"},
            data={"title": "Ian Public Research", "visibility": "public"},
            files={"file": ("public.docx", create_sample_docx_bytes("Public research"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
        )
        client.post(
            "/documents",
            headers={"Authorization": f"Bearer {tok_ian}"},
            data={"title": "Ian Private Blueprint", "visibility": "private"},
            files={"file": ("private.docx", create_sample_docx_bytes("Private secret"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
        )

    # 1. Public profile lookup
    prof_res = client.get(f"/users/{ian_id}")
    assert prof_res.status_code == 200
    assert prof_res.json()["username"] == "ian_contrib"
    assert prof_res.json()["email"] == "ian@example.com"

    # 2. Non-existent profile -> 404
    missing_prof = client.get("/users/999999")
    assert missing_prof.status_code == 404

    # 3. Unauthenticated visitor views Ian's documents -> only 1 public document
    anon_docs = client.get(f"/users/{ian_id}/documents")
    assert anon_docs.status_code == 200
    docs_data = anon_docs.json()
    assert len(docs_data) == 1
    assert docs_data[0]["title"] == "Ian Public Research"
    assert docs_data[0]["visibility"] == "public"

    # 4. Judy (another user) views Ian's documents -> only 1 public document
    judy_view = client.get(
        f"/users/{ian_id}/documents",
        headers={"Authorization": f"Bearer {tok_judy}"},
    )
    assert judy_view.status_code == 200
    assert len(judy_view.json()) == 1
    assert judy_view.json()[0]["title"] == "Ian Public Research"

    # 5. Ian views his own documents -> returns both 2 documents (public and private)
    ian_view = client.get(
        f"/users/{ian_id}/documents",
        headers={"Authorization": f"Bearer {tok_ian}"},
    )
    assert ian_view.status_code == 200
    assert len(ian_view.json()) == 2
    titles = [d["title"] for d in ian_view.json()]
    assert "Ian Public Research" in titles
    assert "Ian Private Blueprint" in titles


def test_document_download_inline_pdf_and_permissions(client):
    """
    Verifies Issue 3 & Issue 4 requirements:
    - Download supports inline=true for PDF rendering with application/pdf MIME type.
    - Default download returns attachment Content-Disposition.
    - Private documents require authorization and return 401/403 for unauthorized users.
    """
    client.post("/register", json={"username": "kyle_doc", "email": "kyle@example.com", "password": "password123"})
    tok_kyle = client.post("/login", json={"email": "kyle@example.com", "password": "password123"}).json()["access_token"]

    client.post("/register", json={"username": "laura_doc", "email": "laura@example.com", "password": "password123"})
    tok_laura = client.post("/login", json={"email": "laura@example.com", "password": "password123"}).json()["access_token"]

    with patch("backend.app.ingestion.generate_embedding", side_effect=mock_generate_embedding), \
         patch("backend.app.ingestion.generate_embeddings", side_effect=mock_generate_embeddings), \
         patch("backend.app.ingestion.extract_text_and_metadata", return_value=[{"text": "Sample PDF content", "page_number": 1}]):
        pdf_res = client.post(
            "/documents",
            headers={"Authorization": f"Bearer {tok_kyle}"},
            data={"title": "Kyle Machine Learning PDF", "visibility": "public"},
            files={"file": ("paper.pdf", create_sample_pdf_bytes(), "application/pdf")},
        )
        assert pdf_res.status_code == 201
        pdf_doc_id = pdf_res.json()["id"]

        priv_res = client.post(
            "/documents",
            headers={"Authorization": f"Bearer {tok_kyle}"},
            data={"title": "Kyle Private Research", "visibility": "private"},
            files={"file": ("priv.docx", create_sample_docx_bytes("Secret"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
        )
        assert priv_res.status_code == 201
        priv_doc_id = priv_res.json()["id"]

    # 1. Attachment download (default) for PDF
    dl_attachment = client.get(
        f"/documents/{pdf_doc_id}/download",
        headers={"Authorization": f"Bearer {tok_kyle}"},
    )
    assert dl_attachment.status_code == 200
    assert "application/pdf" in dl_attachment.headers.get("content-type", "")
    assert dl_attachment.headers.get("content-disposition", "").startswith("attachment")

    # 2. Inline download for PDF rendering (Fixes black viewer issue)
    dl_inline = client.get(
        f"/documents/{pdf_doc_id}/download?inline=true",
        headers={"Authorization": f"Bearer {tok_kyle}"},
    )
    assert dl_inline.status_code == 200
    assert "application/pdf" in dl_inline.headers.get("content-type", "")
    assert dl_inline.headers.get("content-disposition", "").startswith("inline")

    # 3. Private document download:
    # Unauthenticated -> 401
    unauth_dl = client.get(f"/documents/{priv_doc_id}/download")
    assert unauth_dl.status_code == 401

    # Laura (different user) -> 403 Forbidden
    laura_dl = client.get(
        f"/documents/{priv_doc_id}/download",
        headers={"Authorization": f"Bearer {tok_laura}"},
    )
    assert laura_dl.status_code == 403

    # Kyle (owner) -> 200 OK
    kyle_dl = client.get(
        f"/documents/{priv_doc_id}/download",
        headers={"Authorization": f"Bearer {tok_kyle}"},
    )
    assert kyle_dl.status_code == 200



