import os
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import URL

# 1. Load environment variables from .env file before reading configuration
BASE_DIR = Path(__file__).resolve().parent       # backend/app
BACKEND_DIR = BASE_DIR.parent                   # backend
PROJECT_ROOT = BACKEND_DIR.parent               # researchPlatform
dotenv_path = PROJECT_ROOT / ".env"

if dotenv_path.is_file():
    load_dotenv(dotenv_path=dotenv_path)
else:
    load_dotenv()


# --- Database Configuration (PostgreSQL with pgvector / Supabase) ---
DATABASE_URL_RAW = os.getenv("DATABASE_URL")

if DATABASE_URL_RAW:
    # Normalize postgres:// or postgresql:// to postgresql+psycopg://
    url_str = DATABASE_URL_RAW.strip()
    if url_str.startswith("postgres://"):
        url_str = url_str.replace("postgres://", "postgresql+psycopg://", 1)
    elif url_str.startswith("postgresql://") and not url_str.startswith("postgresql+psycopg://"):
        url_str = url_str.replace("postgresql://", "postgresql+psycopg://", 1)

    from sqlalchemy import make_url
    DATABASE_URL = make_url(url_str)
    DB_HOST = DATABASE_URL.host or "localhost"
    DB_PORT = DATABASE_URL.port or 5432
    DB_NAME = DATABASE_URL.database or "research_platform"
    DB_USER = DATABASE_URL.username or "postgres"
    DB_PASSWORD = DATABASE_URL.password or ""
else:
    DB_HOST = os.getenv("DB_HOST", "localhost")
    try:
        DB_PORT = int(os.getenv("DB_PORT", "5432"))
    except (TypeError, ValueError):
        DB_PORT = 5432
    DB_NAME = os.getenv("DB_NAME", "research_platform")
    DB_USER = os.getenv("DB_USER", "postgres")
    DB_PASSWORD = os.getenv("DB_PASSWORD", "")
    DB_SSLMODE = os.getenv("DB_SSLMODE")

    query_params = {}
    if DB_SSLMODE:
        query_params["sslmode"] = DB_SSLMODE

    DATABASE_URL = URL.create(
        drivername="postgresql+psycopg",
        username=DB_USER,
        password=DB_PASSWORD,
        host=DB_HOST,
        port=DB_PORT,
        database=DB_NAME,
        query=query_params if query_params else {},
    )

DB_POOL_SIZE = int(os.getenv("DB_POOL_SIZE", "5"))
DB_MAX_OVERFLOW = int(os.getenv("DB_MAX_OVERFLOW", "5"))
DB_POOL_RECYCLE = int(os.getenv("DB_POOL_RECYCLE", "300"))


# --- Authentication Configuration (JWT & Cookies) ---
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY") or os.getenv("SECRET_KEY")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM") or os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() in ("true", "1", "yes")
COOKIE_SAMESITE = os.getenv("COOKIE_SAMESITE", "lax").lower()


# --- LLM & Embeddings Configuration ---
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("EMBEDDING_API_KEY")
GEMINI_EMBEDDING_MODEL = os.getenv("GEMINI_EMBEDDING_MODEL") or os.getenv(
    "EMBEDDING_MODEL", "models/text-embedding-004"
)
GEMINI_CHAT_MODEL = os.getenv("GEMINI_CHAT_MODEL") or os.getenv(
    "CHAT_MODEL", "models/gemini-3.8-flash"
)
# text-embedding-004 outputs 768-dimensional vectors
EMBEDDING_DIMENSION = 768


# --- Document Chunking & Retrieval Settings ---
CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "500"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "50"))
RETRIEVAL_LIMIT = int(os.getenv("RETRIEVAL_LIMIT", "5"))
MAX_UPLOAD_SIZE_MB = int(os.getenv("MAX_UPLOAD_SIZE_MB", "20"))
MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024


# --- LangSmith Tracing Configuration ---
LANGCHAIN_TRACING_V2 = os.getenv("LANGCHAIN_TRACING_V2", "false").lower() in ("true", "1", "yes")
LANGCHAIN_API_KEY = os.getenv("LANGCHAIN_API_KEY")
LANGCHAIN_PROJECT = os.getenv("LANGCHAIN_PROJECT", "research-platform")
LANGCHAIN_ENDPOINT = os.getenv("LANGCHAIN_ENDPOINT", "https://api.smith.langchain.com")

if LANGCHAIN_TRACING_V2 and LANGCHAIN_API_KEY:
    os.environ["LANGCHAIN_TRACING_V2"] = "true"
    os.environ["LANGCHAIN_API_KEY"] = LANGCHAIN_API_KEY
    os.environ["LANGCHAIN_PROJECT"] = LANGCHAIN_PROJECT
    os.environ["LANGCHAIN_ENDPOINT"] = LANGCHAIN_ENDPOINT
else:
    os.environ["LANGCHAIN_TRACING_V2"] = "false"


# --- CORS Settings ---
cors_raw = os.getenv("CORS_ORIGINS", "")
if cors_raw:
    CORS_ORIGINS = [origin.strip() for origin in cors_raw.split(",") if origin.strip()]
else:
    CORS_ORIGINS = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
    ]


# --- File Upload Storage ---
upload_dir_env = os.getenv("UPLOAD_DIR")
if upload_dir_env:
    upload_path = Path(upload_dir_env)
    UPLOAD_DIR = upload_path if upload_path.is_absolute() else PROJECT_ROOT / upload_path
else:
    UPLOAD_DIR = BACKEND_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
