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
from backend.app.auth import create_access_token
from backend.app.database import Base, get_db
from backend.app.main import app, parse_and_validate_topics
from backend.app.models import User, Document, Topic, DocumentTopic

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


def test_parse_and_validate_topics():
    with TestSessionLocal() as db:
        # 1. Comma-separated parsing and trimming
        topics = parse_and_validate_topics("Artificial Intelligence, Machine Learning, AI", db)
        assert len(topics) == 3
        assert {t.name for t in topics} == {"Artificial Intelligence", "Machine Learning", "AI"}

        # 2. Case-insensitive deduplication
        topics_dedup = parse_and_validate_topics(["AI", "ai", "Ai"], db)
        assert len(topics_dedup) == 1
        assert topics_dedup[0].name.upper() == "AI"

        # 3. Limit to max 5 topics (raises 400 HTTPException on > 5)
        with pytest.raises(Exception) as exc_info:
            parse_and_validate_topics(["T1", "T2", "T3", "T4", "T5", "T6", "T7"], db)
        assert "cannot have more than 5 topics" in str(exc_info.value)

        # 4. JSON array format
        topics_json = parse_and_validate_topics('["Neuroscience", "Genomics"]', db)
        assert len(topics_json) == 2
        assert {t.name for t in topics_json} == {"Neuroscience", "Genomics"}


def test_create_and_filter_document_topics(monkeypatch, tmp_path):
    # Mock ingestion and storage
    monkeypatch.setattr("backend.app.main.ingest_document", lambda *args, **kwargs: None)
    monkeypatch.setattr("backend.app.main.storage_manager.is_production_mode", lambda: False)
    monkeypatch.setattr("backend.app.main.storage_manager.is_supabase_storage_enabled", lambda: False)
    monkeypatch.setattr("backend.app.main.UPLOAD_DIR", tmp_path)

    client = TestClient(app)

    with TestSessionLocal() as session:
        user1 = User(id=1, email="user1@example.com", username="author1", hashed_password="pw")
        user2 = User(id=2, email="user2@example.com", username="author2", hashed_password="pw")
        session.add_all([user1, user2])
        session.commit()

    token1 = create_access_token(subject=1)
    headers1 = {"Authorization": f"Bearer {token1}"}

    # 1. Upload Document 1 with 2 topics
    res1 = client.post(
        "/documents",
        data={
            "title": "Quantum Neural Computing",
            "description": "Paper on hybrid quantum algorithms",
            "visibility": "public",
            "topics": '["Physics", "Artificial Intelligence"]',
        },
        files={"file": ("quantum.pdf", b"%PDF-1.4 dummy", "application/pdf")},
        headers=headers1,
    )
    assert res1.status_code == 201, res1.text
    doc1_data = res1.json()
    assert "topics" in doc1_data
    assert set(doc1_data["topics"]) == {"Physics", "Artificial Intelligence"}

    # 2. Upload Document 2 without topics (Uncategorized)
    res2 = client.post(
        "/documents",
        data={
            "title": "Uncategorized Document",
            "description": "No topics assigned",
            "visibility": "public",
        },
        files={"file": ("uncat.pdf", b"%PDF-1.4 dummy", "application/pdf")},
        headers=headers1,
    )
    assert res2.status_code == 201, res2.text
    doc2_data = res2.json()
    assert doc2_data["topics"] == []

    # 3. Upload Document 3 as Private with Topic "Medicine"
    res3 = client.post(
        "/documents",
        data={
            "title": "Private Oncology Study",
            "description": "Private clinical results",
            "visibility": "private",
            "topics": "Medicine",
        },
        files={"file": ("med.pdf", b"%PDF-1.4 dummy", "application/pdf")},
        headers=headers1,
    )
    assert res3.status_code == 201, res3.text
    doc3_data = res3.json()
    assert doc3_data["topics"] == ["Medicine"]

    # 4. Check GET /topics as unauthenticated user
    # Should see "Physics" (1), "Artificial Intelligence" (1), and "Uncategorized" (1)
    # "Medicine" is private, so unauthenticated user count is 0, thus not in all=False list
    res_topics_anon = client.get("/topics")
    assert res_topics_anon.status_code == 200
    topics_anon = {t["name"]: t["count"] for t in res_topics_anon.json()}
    assert topics_anon.get("Physics") == 1
    assert topics_anon.get("Artificial Intelligence") == 1
    assert topics_anon.get("Uncategorized") == 1
    assert "Medicine" not in topics_anon

    # 5. Check GET /topics as author1 (authenticated)
    # Author1 can see their private document, so Medicine count is 1
    res_topics_auth = client.get("/topics", headers=headers1)
    assert res_topics_auth.status_code == 200
    topics_auth = {t["name"]: t["count"] for t in res_topics_auth.json()}
    assert topics_auth.get("Medicine") == 1

    # 6. Check GET /feed filtering by Topic
    res_feed_ai = client.get("/feed?topic=Artificial Intelligence")
    assert res_feed_ai.status_code == 200
    ai_feed = res_feed_ai.json()
    assert len(ai_feed) == 1
    assert ai_feed[0]["title"] == "Quantum Neural Computing"

    # Filter by Uncategorized
    res_feed_uncat = client.get("/feed?topic=Uncategorized")
    assert res_feed_uncat.status_code == 200
    uncat_feed = res_feed_uncat.json()
    assert len(uncat_feed) == 1
    assert uncat_feed[0]["title"] == "Uncategorized Document"

    # 7. Check Update Document Topics
    doc_id = doc2_data["id"]
    res_update = client.patch(
        f"/documents/{doc_id}",
        json={"topics": ["Data Science", "Economics"]},
        headers=headers1,
    )
    assert res_update.status_code == 200, res_update.text
    updated_doc = res_update.json()
    assert set(updated_doc["topics"]) == {"Data Science", "Economics"}

    # Uncategorized count should now decrease to 0
    res_topics_after = client.get("/topics")
    topics_after = {t["name"]: t["count"] for t in res_topics_after.json()}
    assert "Uncategorized" not in topics_after
    assert topics_after.get("Data Science") == 1
    assert topics_after.get("Economics") == 1
