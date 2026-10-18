# DocMe — Research & Document Intelligence Platform

DocMe is an end-to-end research document platform featuring document ingestion (PDF/DOCX), pgvector semantic vector search, LangGraph RAG conversational Q&A, and scholarly document sharing.

Built with Python, FastAPI, PostgreSQL (pgvector), SQLAlchemy 2.x, LangGraph, and a vanilla JavaScript frontend.

---

## Architecture & Tech Stack

- **Backend Framework**: [FastAPI](https://fastapi.tiangolo.com/) with asynchronous request handling
- **Database**: PostgreSQL with `pgvector` for vector similarity search (Supabase PostgreSQL ready)
- **ORM**: [SQLAlchemy 2.x](https://docs.sqlalchemy.org/en/20/) with `DeclarativeBase` and connection pooling
- **Schemas & Validation**: [Pydantic v2](https://docs.pydantic.dev/latest/)
- **Authentication**: JWT access tokens and HttpOnly refresh tokens with bcrypt password hashing
- **Ingestion**: Document text extraction for PDF (`pypdf`) and Word (`python-docx`) with chunking
- **Embeddings & LLM**: Google Generative AI (Gemini `text-embedding-004` and `gemini-2.0-flash` / `gemini-1.5-flash`)
- **Workflow / RAG Orchestration**: [LangGraph](https://github.com/langchain-ai/langgraph) state graph (`retrieve` -> `generate` -> `END`) with SSE streaming
- **Frontend**: Clean Vanilla JavaScript (ES Modules), HTML5, and CSS3
- **Testing**: `pytest`, `httpx`, and `TestClient` with isolated test database support

---

## Directory Structure

```
researchPlatform/
├── backend/
│   ├── app/
│   │   ├── auth.py          # Password hashing, JWT creation/verification, current-user dependency
│   │   ├── chat.py          # Grounded answer generation with Gemini and SSE streaming
│   │   ├── config.py        # Canonical environment loading and centralized configuration
│   │   ├── database.py      # SQLAlchemy 2.x engine, connection pool, Base, init_db()
│   │   ├── ingestion.py     # Document text extraction (PDF/DOCX), chunking, pgvector embedding storage
│   │   ├── main.py          # Canonical FastAPI entrypoint, routes, CORS, cookie auth
│   │   ├── models.py        # SQLAlchemy models (User, Document, DocumentChunk, Comment)
│   │   ├── nodes.py         # LangGraph workflow nodes (retrieve_node, generate_node)
│   │   ├── retrieval.py     # pgvector cosine similarity search with server-side authorization
│   │   ├── schema.py        # Pydantic v2 request/response schemas
│   │   ├── semantic_search.py # pgvector and keyword document search
│   │   └── workflow.py      # LangGraph compiled state graph (workflow, qa_workflow)
│   └── uploads/             # Local filesystem storage for uploaded documents (.gitignored)
├── frontend/
│   ├── index.html           # Landing & authentication router
│   ├── pages/               # Application views (feed, login, register, profile, document-chat)
│   └── shared/              # Reusable API client, auth helpers, Markdown renderer, components.css
├── tests/
│   └── test_backend.py      # Comprehensive test suite covering auth, documents, permissions, RAG
├── .env.example             # Complete environment configuration template
├── vercel.json              # Vercel deployment and routing configuration
├── requirements.txt         # Production and test dependencies
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
uvicorn backend.app.main:app --reload
```

Or specify host and port explicitly:

```bash
uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000
```

Once running:
- **API Status**: [http://localhost:8000/](http://localhost:8000/)
- **Interactive Swagger Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **Alternative ReDoc**: [http://localhost:8000/redoc](http://localhost:8000/redoc)

---

## Running the Frontend

The DocMe frontend is a static web application built with ES Modules. Serve the `frontend/` directory using Python's built-in HTTP server or any static web server:

```bash
python3 -m http.server 3000 --directory frontend
```

Once running:
- **Application URL**: [http://localhost:3000/](http://localhost:3000/)
- Automatically redirects authenticated users to `/pages/feed.html` and unauthenticated users to `/pages/login.html`.
- Connects automatically to the backend running at [http://localhost:8000/](http://localhost:8000/).

---

## API Endpoints Reference

### Health
- `GET /` — Returns API service status

### Authentication & Email Verification
- `POST /register` — Register a new user (`username`, `email`, `password`) and trigger 6-digit email OTP challenge
- `POST /token` — OAuth2 password form login for Swagger UI and OAuth2 clients (`application/x-www-form-urlencoded` with `username` [user's email] and `password`)
- `POST /login` — JSON login endpoint for frontend and API clients (`application/json` with `email` and `password`)
- `POST /refresh` — Refresh access token using HttpOnly cookie or bearer token
- `POST /logout` — Clear auth cookies and invalidate session
- `GET /me` — Retrieve the authenticated user's profile
- `POST /auth/otp/verify` — Verify 6-digit email OTP (`email`, `otp`, `purpose`)
- `POST /auth/otp/resend` — Request new OTP with 30s server-enforced cooldown

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

2. **Run Pytest (Backend & OTP Security):**
   ```bash
   pytest tests/test_otp.py tests/test_backend.py -v
   ```

3. **Run Node.js Frontend Tests (Auth, Typing Animation, OTP, DOM Validation):**
   ```bash
   node tests/test_frontend_auth.mjs
   node tests/test_typing_indicator.mjs
   node tests/test_frontend_otp.mjs
   node tests/test_register_dom.mjs
   ```

Test coverage includes:
- Root API status check
- User registration, duplicate username/email rejection
- HMAC-SHA256 OTP generation, 30s expiry, max attempt lockout, cooldown, atomic consumption
- Login authentication, invalid credentials, and expired/malformed tokens
- Password hash security (never exposed in responses)
- Document upload (PDF, DOCX) and unsupported file rejection
- Strict authorization checks (private documents isolated from other users)
- Comment permissions and public/private visibility
- Discovery endpoints (`/feed`, `/documents/popular`, `/users/ranking`)
- pgvector similarity retrieval with database-level ownership filtering
- LangGraph Q&A chat endpoint with source citations
- Frontend token refresh deduplication, single 401 retry, DOM validation, and typing indicator lifecycle

---

## Production Deployment Guide

### 1. Database Deployment: Supabase PostgreSQL (Free Plan)

1. Create a free project at [supabase.com](https://supabase.com).
2. Go to **Database > Extensions** and verify `vector` is enabled.
3. In **Project Settings > Database**, find your connection string.
   - For Render web services, use the direct or pooler connection string with `sslmode=require`:
   ```
   postgresql+psycopg://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?sslmode=require
   ```
4. Run schema initialization against Supabase once:
   ```bash
   DATABASE_URL="<your_supabase_url>" python -m backend.app.database
   ```

### 2. Backend Deployment: Render (Free Web Service)

1. Create a new **Web Service** on [render.com](https://render.com) linked to your GitHub repository.
2. Configure settings:
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT`
3. Configure Environment Variables in Render:
   - `DATABASE_URL`: Your Supabase connection string (`postgresql+psycopg://...`)
   - `SUPABASE_URL`: Your Supabase project URL (`https://<project-ref>.supabase.co`)
   - `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service role secret key (enables persistent document storage in private bucket)
   - `SUPABASE_STORAGE_BUCKET`: `documents` (created automatically with private-by-default access)
   - `JWT_SECRET_KEY`: Secure random string (`openssl rand -hex 32`)
   - `GEMINI_API_KEY`: Your Google AI Studio API key
   - `CORS_ORIGINS`: Your Vercel frontend URL (e.g. `https://docme.vercel.app`)
   - `COOKIE_SECURE`: `true`
   - `COOKIE_SAMESITE`: `none` (required for cross-domain cookie transmission over HTTPS)
4. Deploy the service. Once active, note the assigned URL: `https://<service-name>.onrender.com`.

> [!NOTE]
> **Render Free Plan & File Persistence**:
> - Free instances spin down after 15 minutes of inactivity. The first request after idle takes ~30-50 seconds (cold start).
> - Render's local container disk is ephemeral. Stored vector chunks and embeddings in Supabase persist indefinitely across restarts. Original document files are automatically stored in the private Supabase Storage bucket (`documents`) and cached locally, ensuring document viewing and downloads persist seamlessly across Render restarts and redeployments.

### 3. Frontend Deployment: Vercel (Free Plan)

1. Import your GitHub repository on [vercel.com](https://vercel.com).
2. The included `vercel.json` automatically configures URL rewriting for the static frontend.
3. In **Settings > Environment Variables**, add:
   - `RESEARCH_API_URL` or `DOCME_API_URL`: Your Render backend URL (e.g. `https://<service-name>.onrender.com`)
4. Deploy the project. The frontend will be live on `https://<your-project>.vercel.app`.

