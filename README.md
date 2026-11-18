# DocMe

Full-stack RAG research platform for PDF/DOCX ingestion, semantic vector search, and SSE-streamed conversational Q&A.

[![Open DocMe](https://img.shields.io/badge/Open-DocMe-4f46e5?style=for-the-badge&logo=rocket&logoColor=white)](https://docme-frontend.vercel.app/)

---

## Core Capabilities

- **Ingestion & Deduplication:** PDF/DOCX parsing (`pypdf`, `python-docx`), SHA-256 content hashing, overlapping chunking, and 768-dim embeddings (`text-embedding-004`).
- **Vector Search & RAG:** PostgreSQL + `pgvector` cosine similarity search with LangGraph retrieval/generation workflow and Gemini SSE token streaming.
- **Document Rendering:** Client-side PDF (`pdfjs-dist`) and DOCX (`docx-preview`) rendering with authenticated inline/attachment downloads.
- **Storage:** Private Supabase Storage bucket (`documents`) with local cache fallback.
- **Auth & RBAC:** bcrypt password hashing, JWT bearer access tokens, HttpOnly refresh cookie rotation, and public/private document visibility enforcement.
- **Discovery:** Topic-filtered public feed, semantic search, popularity rankings, contributor profiles, and per-document comments.

---

## Tech Stack

| Layer | Stack |
| :--- | :--- |
| **Frontend** | React 19, Vite, React Router, `pdfjs-dist`, `docx-preview` |
| **Backend** | Python, FastAPI, Uvicorn, SQLAlchemy, Pydantic |
| **AI / RAG** | LangGraph, Google Gemini API (`text-embedding-004`, Gemini Flash) |
| **Database** | PostgreSQL + `pgvector` (Supabase) |
| **Object Storage** | Supabase Storage |
| **Deployment** | Vercel (Frontend), Render (Backend) |

---

## Structure

```text
.
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── auth.py
│   │   ├── database.py
│   │   ├── models.py
│   │   ├── schema.py
│   │   ├── config.py
│   │   ├── ingestion.py
│   │   ├── retrieval.py
│   │   ├── semantic_search.py
│   │   ├── workflow.py
│   │   ├── nodes.py
│   │   ├── chat.py
│   │   └── storage.py
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── context/
│   │   ├── hooks/
│   │   ├── layouts/
│   │   ├── pages/
│   │   ├── services/
│   │   ├── styles/
│   │   ├── utils/
│   │   ├── App.jsx
│   │   └── main.jsx
│   └── index.html
├── scripts/
│   ├── build.js
│   └── migrate_to_supabase_storage.py
├── package.json
├── vite.config.js
└── vercel.json
```
