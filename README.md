# Research Platform Backend

A backend platform for document ingestion, retrieval-augmented generation (RAG), and document-specific conversational question-answering powered by FastAPI, PostgreSQL (pgvector), SQLAlchemy 2.x, and LangGraph.

---

## Architecture & Tech Stack

- **Framework**: [FastAPI](https://fastapi.tiangolo.com/) with asynchronous request handling
- **Database**: PostgreSQL with `pgvector` for vector similarity search
- **ORM**: [SQLAlchemy 2.x](https://docs.sqlalchemy.org/en/20/) with `DeclarativeBase` and `Session`
- **Schemas & Validation**: [Pydantic v2](https://docs.pydantic.dev/latest/)
- **Authentication**: JWT (JSON Web Tokens) with `HS256` and bcrypt password hashing
- **Ingestion**: Supports PDF (`pypdf`) and Word documents (`python-docx`)
- **Embeddings & LLM**: Google Generative AI (Gemini) with 768-dimensional embeddings (`models/gemini-embedding-001` or compatible)
- **Workflow / RAG Orchestration**: [LangGraph](https://github.com/langchain-ai/langgraph) state graph (`retrieve` -> `generate` -> `END`)
- **Testing**: `pytest`, `pytest-cov`, `httpx`, and `TestClient` with isolated test database support

---

## Directory Structure

```
researchPlatform/
├── backend/
│   ├── app/
│   │   ├── auth.py          # Password hashing, JWT creation/verification, current-user dependency
│   │   ├── chat.py          # Answer generation with Gemini and streaming support
│   │   ├── database.py      # SQLAlchemy 2.x engine, SessionLocal, Base, init_db()
│   │   ├── ingestion.py     # Document text extraction (PDF/DOCX), chunking, pgvector embedding storage
│   │   ├── models.py        # SQLAlchemy models (User, Document, DocumentChunk, Comment)
│   │   ├── nodes.py         # LangGraph workflow nodes (retrieve_node, generate_node)
│   │   ├── retrieval.py     # pgvector cosine similarity search with server-side authorization
│   │   ├── schema.py        # Pydantic v2 request/response schemas
│   │   └── workflow.py      # LangGraph compiled state graph (workflow, qa_workflow)
│   ├── config.py            # Centralized environment loading and configuration
│   ├── main.py              # FastAPI app instance, CORS middleware, and API route definitions
│   └── uploads/             # Local filesystem storage for uploaded documents (.gitignored)
├── tests/
│   └── test_backend.py      # Comprehensive test suite covering auth, documents, permissions, RAG
├── requirements.txt         # Pinned production and test dependencies
├── .gitignore               # Excludes secrets, virtual environments, cache, and uploaded files
└── README.md                # Project documentation and guide
```

---

## Prerequisites

- **Python**: 3.10+ (tested with Python 3.14)
- **PostgreSQL**: 15+ with the `pgvector` extension installed
- **Google AI Studio API Key**: For Gemini embeddings and chat

---

## Environment Setup

1. **Clone or navigate to the repository:**
   ```bash
   cd /home/vinay-pratap-raghuwanshi/researchPlatform
   ```

2. **Create and activate a virtual environment:**
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```

3. **Install dependencies:**
   ```bash
   pip install --upgrade pip
   pip install -r requirements.txt
   ```

4. **Configure environment variables:**
   Create a `.env` file in the project root:
   ```env
   # Database Configuration
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=research_platform
   DB_USER=postgres
   DB_PASSWORD=your_postgres_password

   # Authentication
   JWT_SECRET_KEY=your_secure_random_secret_key
   JWT_ALGORITHM=HS256
   ACCESS_TOKEN_EXPIRE_MINUTES=60

   # LLM and Embeddings
   GEMINI_API_KEY=your_gemini_api_key
   EMBEDDING_MODEL=models/gemini-embedding-001
   CHAT_MODEL=models/gemini-2.0-flash

   # Chunking & Retrieval
   CHUNK_SIZE=1000
   CHUNK_OVERLAP=150
   RETRIEVAL_LIMIT=5

   # Application & Storage
   UPLOAD_DIR=backend/uploads
   CORS_ORIGINS=http://localhost:3000,http://localhost:8000
   ```

---

## Database Initialization

Ensure the PostgreSQL server is running and the database exists.

1. **Create the database (if not already present):**
   ```bash
   createdb -U postgres research_platform
   ```

2. **Initialize Schema & Enable pgvector:**
   Run the schema initialization script:
   ```bash
   python -m backend.app.database
   ```
   This safely executes `CREATE EXTENSION IF NOT EXISTS vector;` and creates all required tables (`users`, `documents`, `document_chunks`, `comments`) with appropriate foreign keys and indexes.

---

## Running the Backend

Start the FastAPI development server with Uvicorn:

```bash
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

Once running:
- **API Status**: [http://localhost:8000/](http://localhost:8000/)
- **Interactive Swagger Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **Alternative ReDoc**: [http://localhost:8000/redoc](http://localhost:8000/redoc)

---

## API Endpoints Reference

### Health
- `GET /` — Returns API service status

### Authentication
- `POST /register` — Register a new user (`username`, `email`, `password`)
- `POST /token` — OAuth2 password form login for Swagger UI and OAuth2 clients (`application/x-www-form-urlencoded` with `username` [user's email] and `password`)
- `POST /login` — JSON login endpoint for frontend and API clients (`application/json` with `email` and `password`)
- `GET /me` — Retrieve the authenticated user's profile

### Discovery & Feeds
- `GET /feed` (or `GET /documents/feed`) — Public document feed
- `GET /documents/popular` — Documents ranked by total comment count
- `GET /users/ranking` — Users ranked by total documents uploaded

### Documents
- `POST /documents` — Upload a PDF or DOCX file with title, description, and visibility (`public` or `private`)
- `GET /documents` — List documents (all public documents + user's own private documents)
- `GET /documents/{document_id}` — Get document details (authorized users only)
- `PATCH /documents/{document_id}` — Update document title, description, or visibility (owner only)
- `GET /documents/{document_id}/download` — Download original document file (authorized users only)

### Comments
- `POST /documents/{document_id}/comments` — Add a comment to an accessible document
- `GET /documents/{document_id}/comments` — List comments for an accessible document

### RAG Chat
- `POST /documents/{document_id}/chat` — Chat with a specific document
  - Body: `{"question": "What are the key findings?"}`
  - Non-streaming (default or `?stream=false`): Returns JSON `ChatResponse` with `answer` and `sources` citations.
  - Streaming (`?stream=true`): Returns `StreamingResponse` (`text/event-stream`) emitting SSE events:
    - `event: sources` — Initial list of retrieved source chunk citations
    - `event: message` — Generated token chunks as they arrive from the provider
    - `event: done` — Completion signal (`{"status": "completed"}`)
    - `event: error` — Safe error detail if generation encounters an issue
  - Enforces server-side document access authorization and pgvector chunk retrieval in both modes.

---

## Running the Test Suite

Tests use an isolated database (`research_platform_test`) to ensure no production data is modified.

1. **Create the test database (once):**
   ```bash
   createdb -U postgres research_platform_test
   ```

2. **Run Pytest:**
   ```bash
   pytest tests/test_backend.py -v
   ```

All 12 test suites cover:
- Root API status check
- User registration, duplicate username/email rejection
- Login authentication, invalid credentials, and expired/malformed tokens
- Password hash security (never exposed in responses)
- Document upload (PDF, DOCX) and unsupported file rejection
- Strict authorization checks (private documents isolated from other users)
- Comment permissions and public/private visibility
- Discovery endpoints (`/feed`, `/documents/popular`, `/users/ranking`)
- pgvector similarity retrieval with database-level ownership filtering
- LangGraph Q&A chat endpoint with source citations
