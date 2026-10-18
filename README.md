# DocMe — Research & Document Intelligence Platform

DocMe is an end-to-end, production-ready research intelligence platform designed for researchers, academics, and engineering teams. Users can upload research papers, academic articles, and technical documentation across multiple formats (PDF, DOCX, TXT), automatically extract and chunk text content, compute semantic embeddings using Google Gemini (`text-embedding-004`), index high-dimensional vectors in PostgreSQL using `pgvector`, and perform grounded conversational question-answering with real-time streaming citations orchestrated via LangGraph workflows.

---

## Live Website

Access the production deployment of DocMe:

[![Open DocMe](https://img.shields.io/badge/Open-DocMe-4f46e5?style=for-the-badge&logo=rocket&logoColor=white)](https://docme-frontend.vercel.app/)

**Primary URL:** [https://docme-frontend.vercel.app/](https://docme-frontend.vercel.app/)

---

## Features

- **Multi-Format Document Ingestion:** Uploads, validates, and parses PDF, Microsoft Word (`.docx`), and plain text (`.txt`) documents with strict file-type and size checks.
- **SHA-256 Deduplication:** Computes cryptographic hashes of incoming files to prevent redundant uploads and avoid re-indexing existing content.
- **Semantic Chunking & Vector Indexing:** Extracts text, chunks content with configurable token overlaps, and generates 768-dimensional vector embeddings via Google Gemini (`text-embedding-004`), indexed in PostgreSQL with `pgvector` HNSW/cosine indexes.
- **Agentic Conversational Q&A:** LangGraph-orchestrated question-answering workflow that retrieves relevant context chunks, ranks sources, and generates precise, grounded answers using Google Gemini with page-level citations.
- **Real-Time Token Streaming:** Supports Server-Sent Events (SSE) streaming (`stream=true`) for live, token-by-token answer generation in the document chat interface.
- **In-Browser Document Viewer & Downloader:** Dedicated document previewer and authenticated download endpoints supporting inline browser viewing and attachment downloads.
- **Persistent Cloud Storage:** Cloud object storage powered by Supabase Storage (`documents` private bucket) with local container caching, ensuring document files persist across server deployments and restarts.
- **Streamlined Authentication:** Direct email and username registration and login with bcrypt-hashed passwords, stateless JWT access tokens, and secure HTTP-only refresh cookies with session rotation.
- **Social Research Feed & Collaboration:** Public research feed, search query filtering, document popularity metrics, user contributor leaderboards, and per-document comment discussions.
- **Strict Access Control:** Enforces private vs. public visibility on retrieval, chat, download, and metadata management, ensuring private documents are accessible only to their owners.

---

## Tech Stack

| Layer | Technology | Description |
| :--- | :--- | :--- |
| **Frontend** | Vanilla JavaScript (ES Modules), HTML5, CSS3 | Zero-dependency, performant client with modern responsive design and CSS design tokens |
| **Backend Framework** | Python 3.10+, FastAPI, Uvicorn | Asynchronous REST API server with OpenAPI docs and Server-Sent Events (SSE) streaming |
| **AI & Orchestration** | LangChain, LangGraph, Google Gemini API | `text-embedding-004` (768-dim embeddings) and `gemini-1.5-flash` for conversational synthesis |
| **Database & Vector Store** | PostgreSQL 15+ with `pgvector` (Supabase) | Relational schema storage combined with vector cosine similarity search |
| **Object Storage** | Supabase Storage (`documents` bucket) | Durable, persistent cloud object storage with local filesystem caching |
| **Frontend Hosting** | Vercel | Static CDN deployment with build-time environment variable injection (`scripts/build.js`) |
| **Backend Hosting** | Render | Managed container web service running FastAPI and Uvicorn |



## Repository Directory Structure

```text
.
├── backend/
│   ├── app/
│   │   ├── auth.py              # JWT tokens, password hashing, and user dependencies
│   │   ├── chat.py              # Conversational chat handler and SSE streaming logic
│   │   ├── config.py            # Environment settings and configuration parsing
│   │   ├── database.py          # SQLAlchemy engine, session maker, and sequence synchronizer
│   │   ├── ingestion.py         # Multi-format document parsing (PDF, DOCX, TXT) and chunking
│   │   ├── main.py              # FastAPI application instance, CORS, and route definitions
│   │   ├── models.py            # SQLAlchemy database models (User, Document, Chunk, Comment)
│   │   ├── nodes.py             # LangGraph state nodes for context retrieval and synthesis
│   │   ├── retrieval.py         # Semantic vector retrieval over pgvector
│   │   ├── schema.py            # Pydantic v2 validation models and schemas
│   │   ├── semantic_search.py   # Vector similarity functions and embedding generators
│   │   ├── storage.py           # Persistent storage manager (Supabase Storage + local cache)
│   │   └── workflow.py          # Compiled LangGraph Q&A state graph
│   └── uploads/                 # Local directory for cached document files
├── frontend/
│   ├── index.html               # Landing page and platform introduction
│   ├── pages/
│   │   ├── document-chat.html   # Split-screen document viewer and conversational Q&A interface
│   │   ├── feed.html            # Research document feed, search, and rankings
│   │   ├── login.html           # Authentication and login interface
│   │   ├── profile.html         # User profile, uploaded documents manager, and stats
│   │   └── register.html        # Direct account registration interface
│   ├── shared/
│   │   ├── api.js               # Centralized API fetch wrapper and token refresher
│   │   ├── auth.js              # Client authentication state management
│   │   ├── env.js               # Runtime configuration populated during build
│   │   └── styles.css           # Global CSS variables, reset, layout, and component styling
│   └── vercel.json              # Vercel deployment routing and cache header configuration
├── scripts/
│   ├── build.js                 # Deployment script injecting backend API URL into frontend
│   └── migrate_to_supabase_storage.py # Migration tool to transfer local files to Supabase Storage
├── tests/
│   ├── test_backend.py          # Pytest suite for API endpoints and document workflows
│   ├── test_chat_diagnostics.py # Tests for chat retrieval and LangGraph execution
│   ├── test_session_isolation.py# Tests for multi-user session boundaries and private doc security
│   ├── test_simplified_auth.py  # Tests for direct registration, login, and sequence sync
│   ├── test_backend_url_config.mjs # Frontend test verifying build URL injection
│   ├── test_document_deletion_frontend.mjs # Frontend test for document deletion workflows
│   ├── test_frontend_auth.mjs   # Frontend test for token persistence and session expiry
│   ├── test_frontend_otp.mjs    # Frontend test verifying absence of obsolete OTP forms
│   ├── test_profile_upload.mjs  # Frontend test for upload modal interactions
│   └── test_responsiveness.mjs  # Frontend responsive layout validation
├── .env.example                 # Comprehensive environment variable template
├── package.json                 # Node.js project manifest and frontend test scripts
├── requirements.txt             # Python dependencies manifest
├── vercel.json                  # Root Vercel configuration
└── README.md                    # Project documentation
```


