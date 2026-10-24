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
from backend.app.auth import create_access_token, hash_password
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


def test_document_count_reconciliation_and_visibility():
    """
    Regression Test for Bug Fix 2: Reconcile Missing Documents and Contributor Counts.
    Verifies:
    1. Multiple documents owned by one user (2 public, 1 private).
    2. Public and private document separation in /feed (only 2 public documents shown).
    3. Accurate My Documents results (/documents?filter_by=mine returns all 3 documents).
    4. Accurate contributor counts in /users/ranking (reflects total 3 documents).
    5. Correct public-feed visibility (never leaks private documents).
    6. Correct behavior when a document request fails (404 for invalid, 403 for unauthorized).
    """
    storage_manager.upload_dir.mkdir(parents=True, exist_ok=True)
    test_pdf_file = storage_manager.upload_dir / "sample_doc.pdf"
    with open(test_pdf_file, "wb") as f:
        f.write(b"%PDF-1.4 test content")

    with TestSessionLocal() as session:
        # Create user Alice (contributor with 3 documents: 2 public, 1 private)
        alice = User(
            username="alice_researcher",
            email="alice@docme.org",
            hashed_password=hash_password("password123"),
            is_verified=True,
        )
        # Create user Bob (another user)
        bob = User(
            username="bob_reviewer",
            email="bob@docme.org",
            hashed_password=hash_password("password123"),
            is_verified=True,
        )
        session.add_all([alice, bob])
        session.commit()
        session.refresh(alice)
        session.refresh(bob)

        # Alice's 3 documents: 2 public, 1 private
        doc_pub1 = Document(
            title="Public Research Paper 1",
            description="Open findings 1",
            file_path=str(test_pdf_file),
            file_type="pdf",
            user_id=alice.id,
            visibility="public",
        )
        doc_pub2 = Document(
            title="Public Research Paper 2",
            description="Open findings 2",
            file_path=str(test_pdf_file),
            file_type="pdf",
            user_id=alice.id,
            visibility="public",
        )
        doc_priv = Document(
            title="Private Research Study 3",
            description="Confidential findings 3",
            file_path=str(test_pdf_file),
            file_type="pdf",
            user_id=alice.id,
            visibility="private",
        )
        session.add_all([doc_pub1, doc_pub2, doc_priv])
        session.commit()

        alice_id = alice.id
        bob_id = bob.id
        priv_doc_id = doc_priv.id

    client = TestClient(app)
    alice_token = create_access_token(subject=alice_id)
    bob_token = create_access_token(subject=bob_id)

    # 1. Contributor ranking: Alice has exactly 3 documents in /users/ranking
    resp_ranking = client.get("/users/ranking")
    assert resp_ranking.status_code == 200
    rankings = resp_ranking.json()
    alice_ranking = next((r for r in rankings if r["user_id"] == alice_id), None)
    assert alice_ranking is not None
    assert alice_ranking["document_count"] == 3

    # 2. Public feed (/feed): Only Alice's 2 public documents are visible
    resp_feed = client.get("/feed")
    assert resp_feed.status_code == 200
    feed_docs = resp_feed.json()
    alice_feed_docs = [d for d in feed_docs if d["user_id"] == alice_id]
    assert len(alice_feed_docs) == 2
    assert all(d["visibility"] == "public" for d in alice_feed_docs)
    assert not any(d["id"] == priv_doc_id for d in feed_docs)

    # 3. My Documents (/documents?filter_by=mine): Alice receives all 3 documents (2 public, 1 private)
    resp_mine = client.get(
        "/documents?filter_by=mine",
        headers={"Authorization": f"Bearer {alice_token}"},
    )
    assert resp_mine.status_code == 200
    my_docs = resp_mine.json()
    assert len(my_docs) == 3
    my_visibilities = [d["visibility"] for d in my_docs]
    assert my_visibilities.count("public") == 2
    assert my_visibilities.count("private") == 1

    # 4. Public filter (/documents?filter_by=public): Returns only public documents
    resp_public_filter = client.get(
        "/documents?filter_by=public",
        headers={"Authorization": f"Bearer {alice_token}"},
    )
    assert resp_public_filter.status_code == 200
    assert all(d["visibility"] == "public" for d in resp_public_filter.json())
    assert len([d for d in resp_public_filter.json() if d["user_id"] == alice_id]) == 2

    # 5. Contributor documents (/users/{id}/documents):
    # As the owner (Alice): receives all 3 documents
    resp_alice_by_owner = client.get(
        f"/users/{alice_id}/documents",
        headers={"Authorization": f"Bearer {alice_token}"},
    )
    assert resp_alice_by_owner.status_code == 200
    assert len(resp_alice_by_owner.json()) == 3

    # As another user (Bob): receives only the 2 public documents
    resp_alice_by_bob = client.get(
        f"/users/{alice_id}/documents",
        headers={"Authorization": f"Bearer {bob_token}"},
    )
    assert resp_alice_by_bob.status_code == 200
    assert len(resp_alice_by_bob.json()) == 2
    assert all(d["visibility"] == "public" for d in resp_alice_by_bob.json())

    # 6. Correct behavior when a document request fails:
    # 404 for non-existent document
    resp_404 = client.get("/documents/999999", headers={"Authorization": f"Bearer {alice_token}"})
    assert resp_404.status_code == 404

    # 403 when Bob attempts to access Alice's private document
    resp_403 = client.get(f"/documents/{priv_doc_id}", headers={"Authorization": f"Bearer {bob_token}"})
    assert resp_403.status_code == 403

    # 401 when unauthenticated visitor attempts to access private document
    resp_401 = client.get(f"/documents/{priv_doc_id}")
    assert resp_401.status_code == 401
