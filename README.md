# DocMe — Research & Document Intelligence Platform

DocMe is an end-to-end, production-ready research intelligence platform designed for researchers, academics, and engineering teams. Users can upload research papers, academic articles, and technical documentation across multiple formats (PDF, DOCX, TXT), perform grounded conversational question-answering with real-time streaming citations orchestrated via LangGraph workflows.

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
│   │   ├── auth.py              
│   │   ├── chat.py              
│   │   ├── config.py            
│   │   ├── database.py          
│   │   ├── ingestion.py         
│   │   ├── main.py              
│   │   ├── models.py            
│   │   ├── nodes.py             
│   │   ├── retrieval.py          
│   │   ├── schema.py            
│   │   ├── semantic_search.py   
│   │   ├── storage.py           
│   │   └── workflow.py          
│   └── uploads/                 
├── frontend/
│   ├── index.html               
│   ├── pages/
│   │   ├── document-chat.html   
│   │   ├── feed.html            
│   │   ├── login.html           
│   │   ├── profile.html         
│   │   └── register.html        
│   ├── shared/
│   │   ├── api.js               
│   │   ├── auth.js              
│   │   ├── env.js               
│   │   └── styles.css           
│   └── vercel.json              
├── scripts/
│   ├── build.js                 
│   └── migrate_to_supabase_storage.py 
├── tests/
│   ├── test_backend.py          
│   ├── test_chat_diagnostics.py 
│   ├── test_session_isolation.py
│   ├── test_simplified_auth.py 
│   ├── test_backend_url_config.mjs 
│   ├── test_document_deletion_frontend.mjs 
│   ├── test_frontend_auth.mjs   
│   ├── test_frontend_otp.mjs    
│   ├── test_profile_upload.mjs  
│   └── test_responsiveness.mjs  
├── .env.example                 
├── package.json                 
├── requirements.txt             
├── vercel.json                  
└── README.md                    
```


