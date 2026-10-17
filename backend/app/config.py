import os
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv
from sqlalchemy import URL

# 1. Base Paths & Environment Loading
BASE_DIR = Path(__file__).resolve().parent       # backend/app
BACKEND_DIR = BASE_DIR.parent                   # backend
PROJECT_ROOT = BACKEND_DIR.parent               # researchPlatform
dotenv_path = PROJECT_ROOT / ".env"

# Load local .env without overwriting environment variables already provided by deployment/Render
if dotenv_path.is_file():
    load_dotenv(dotenv_path=dotenv_path, override=False)
else:
    load_dotenv(override=False)


# --- Helper Parsing and Validation Functions ---

def _parse_int(key: str, required: bool = False) -> Optional[int]:
    """Parse an integer environment variable, raising a clear non-sensitive error if required or malformed."""
    val = os.getenv(key)
    if val is None or val.strip() == "":
        if required:
            raise ValueError(f"Missing required integer configuration: '{key}' must be set in environment or .env")
        return None
    try:
        return int(val.strip())
    except ValueError as exc:
        raise ValueError(f"Invalid integer configuration for '{key}': '{val}'") from exc


def _parse_bool(key: str, default: bool = False) -> bool:
    """Parse a boolean environment variable safely."""
    val = os.getenv(key)
    if val is None or val.strip() == "":
        return default
    return val.strip().lower() in ("true", "1", "yes", "on")


def _parse_list(key: str) -> list[str]:
    """Parse a comma-separated list environment variable."""
    val = os.getenv(key)
    if not val:
        return []
    return [item.strip() for item in val.split(",") if item.strip()]


# --- Database Configuration (PostgreSQL with pgvector / Supabase) ---
DATABASE_URL_RAW = os.getenv("DATABASE_URL")

if DATABASE_URL_RAW and DATABASE_URL_RAW.strip():
    url_str = DATABASE_URL_RAW.strip()
    if url_str.startswith("postgres://"):
        url_str = url_str.replace("postgres://", "postgresql+psycopg://", 1)
    elif url_str.startswith("postgresql://") and not url_str.startswith("postgresql+psycopg://"):
        url_str = url_str.replace("postgresql://", "postgresql+psycopg://", 1)

    from sqlalchemy import make_url
    DATABASE_URL = make_url(url_str)
    DB_HOST = DATABASE_URL.host or ""
    DB_PORT = DATABASE_URL.port or 5432
    DB_NAME = DATABASE_URL.database or ""
    DB_USER = DATABASE_URL.username or ""
    DB_PASSWORD = DATABASE_URL.password or ""
    DB_SSLMODE = DATABASE_URL.query.get("sslmode")
else:
    DB_HOST = os.getenv("DB_HOST", "localhost")
    DB_PORT = _parse_int("DB_PORT", required=True)
    DB_NAME = os.getenv("DB_NAME", "research_platform")
    DB_USER = os.getenv("DB_USER", "postgres")
    DB_PASSWORD = os.getenv("DB_PASSWORD", "")
    DB_SSLMODE = os.getenv("DB_SSLMODE")

    query_params = {}
    if DB_SSLMODE and DB_SSLMODE.strip():
        query_params["sslmode"] = DB_SSLMODE.strip()

    DATABASE_URL = URL.create(
        drivername="postgresql+psycopg",
        username=DB_USER,
        password=DB_PASSWORD,
        host=DB_HOST,
        port=DB_PORT,
        database=DB_NAME,
        query=query_params if query_params else {},
    )

DB_POOL_SIZE = _parse_int("DB_POOL_SIZE", required=True)
DB_MAX_OVERFLOW = _parse_int("DB_MAX_OVERFLOW", required=True)
DB_POOL_RECYCLE = _parse_int("DB_POOL_RECYCLE", required=True)


# --- Authentication Configuration (JWT & Cookies) ---
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY")
if not JWT_SECRET_KEY:
    raise ValueError("Missing required configuration: 'JWT_SECRET_KEY' must be set in environment or .env")

JWT_ALGORITHM = os.getenv("JWT_ALGORITHM")
if not JWT_ALGORITHM:
    raise ValueError("Missing required configuration: 'JWT_ALGORITHM' must be set in environment or .env")

SECRET_KEY = JWT_SECRET_KEY
ALGORITHM = JWT_ALGORITHM

ACCESS_TOKEN_EXPIRE_MINUTES = _parse_int("ACCESS_TOKEN_EXPIRE_MINUTES", required=True)
REFRESH_TOKEN_EXPIRE_DAYS = _parse_int("REFRESH_TOKEN_EXPIRE_DAYS", required=True)

# Cookie Security & SameSite Policy:
# In cross-domain production (e.g. Vercel frontend talking to Render backend),
# modern browsers require SameSite=None and Secure=True for credentialed requests.
# For local HTTP development, SameSite=lax and Secure=False is used.
COOKIE_SECURE = _parse_bool("COOKIE_SECURE", default=_parse_bool("RENDER", default=False))
_raw_samesite = (os.getenv("COOKIE_SAMESITE") or "").strip().lower()
if _raw_samesite in ("lax", "none", "strict"):
    COOKIE_SAMESITE = _raw_samesite
else:
    COOKIE_SAMESITE = "none" if COOKIE_SECURE else "lax"

# Modern browsers strictly require Secure=True if SameSite=None
if COOKIE_SAMESITE == "none" and not COOKIE_SECURE:
    COOKIE_SECURE = True


# --- LLM & Embeddings Configuration ---
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_EMBEDDING_MODEL = os.getenv("GEMINI_EMBEDDING_MODEL")
GEMINI_CHAT_MODEL = os.getenv("GEMINI_CHAT_MODEL")
EMBEDDING_DIMENSION = _parse_int("EMBEDDING_DIMENSION", required=True)


# --- Document Chunking & Retrieval Settings ---
CHUNK_SIZE = _parse_int("CHUNK_SIZE", required=True)
CHUNK_OVERLAP = _parse_int("CHUNK_OVERLAP", required=True)
RETRIEVAL_LIMIT = _parse_int("RETRIEVAL_LIMIT", required=True)
MAX_UPLOAD_SIZE_MB = _parse_int("MAX_UPLOAD_SIZE_MB", required=True)
MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024


# --- LangSmith Tracing Configuration ---
LANGCHAIN_TRACING_V2 = _parse_bool("LANGCHAIN_TRACING_V2", default=False)
LANGCHAIN_API_KEY = os.getenv("LANGCHAIN_API_KEY")
LANGCHAIN_PROJECT = os.getenv("LANGCHAIN_PROJECT")
LANGCHAIN_ENDPOINT = os.getenv("LANGCHAIN_ENDPOINT")

if LANGCHAIN_TRACING_V2 and LANGCHAIN_API_KEY:
    os.environ["LANGCHAIN_TRACING_V2"] = "true"
    os.environ["LANGCHAIN_API_KEY"] = LANGCHAIN_API_KEY
    if LANGCHAIN_PROJECT:
        os.environ["LANGCHAIN_PROJECT"] = LANGCHAIN_PROJECT
    if LANGCHAIN_ENDPOINT:
        os.environ["LANGCHAIN_ENDPOINT"] = LANGCHAIN_ENDPOINT
else:
    os.environ["LANGCHAIN_TRACING_V2"] = "false"


# --- CORS Settings ---
DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:5500",
    "http://localhost:8000",
    "http://localhost:8080",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5500",
    "http://127.0.0.1:8000",
    "http://127.0.0.1:8080",
    "https://docme-frontend.vercel.app",
]

DEFAULT_LOCALHOST_ORIGINS = DEFAULT_ALLOWED_ORIGINS


def _parse_cors_origins(key: str = "CORS_ORIGINS") -> list[str]:
    """
    Parse a comma-separated list of allowed CORS origins from an environment variable.
    - Preserves baseline localhost and deployed production Vercel origins.
    - Normalizes origins by trimming whitespace, enclosing quotes, and trailing slashes.
    - Strips paths if mistakenly entered (e.g., 'https://docme-frontend.vercel.app/' -> 'https://docme-frontend.vercel.app').
    - Excludes wildcard '*' because allow_credentials=True is enabled for session cookies.
    """
    from urllib.parse import urlsplit

    origins: list[str] = list(DEFAULT_ALLOWED_ORIGINS)
    val = os.getenv(key)
    if not val:
        return origins

    for item in val.split(","):
        clean = item.strip().strip("\"'").strip()
        if not clean:
            continue
        # Wildcard '*' combined with credentials: 'include' violates the CORS specification
        if clean == "*":
            continue
        if clean.startswith(("http://", "https://")):
            parsed = urlsplit(clean)
            if parsed.scheme and parsed.netloc:
                clean = f"{parsed.scheme}://{parsed.netloc}"
        else:
            clean = clean.rstrip("/")

        if clean and clean not in origins:
            origins.append(clean)

    return origins


CORS_ORIGINS = _parse_cors_origins("CORS_ORIGINS")

# Origin regex: allows any localhost/127.0.0.1 port and docme-frontend (including Vercel preview deployments)
CORS_ORIGIN_REGEX = os.getenv(
    "CORS_ORIGIN_REGEX",
    r"^(https?://(localhost|127\.0\.0\.1)(:[0-9]+)?|https://docme-frontend(-[a-zA-Z0-9_-]+)?\.vercel\.app)$",
)


# --- File Upload Storage ---
upload_dir_env = os.getenv("UPLOAD_DIR")
if upload_dir_env and upload_dir_env.strip():
    upload_path = Path(upload_dir_env.strip())
    UPLOAD_DIR = upload_path if upload_path.is_absolute() else PROJECT_ROOT / upload_path
else:
    UPLOAD_DIR = BACKEND_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


# --- Email & OTP Security Configuration ---
OTP_SECRET_KEY = os.getenv("OTP_SECRET_KEY")
if not OTP_SECRET_KEY:
    raise ValueError("Missing required configuration: 'OTP_SECRET_KEY' must be set in environment or .env")

OTP_VALIDITY_SECONDS = _parse_int("OTP_VALIDITY_SECONDS", required=True)
OTP_RESEND_COOLDOWN_SECONDS = _parse_int("OTP_RESEND_COOLDOWN_SECONDS", required=True)
OTP_MAX_ATTEMPTS = _parse_int("OTP_MAX_ATTEMPTS", required=True)
OTP_MAX_HOURLY_SENDS = _parse_int("OTP_MAX_HOURLY_SENDS", required=True)
REQUIRE_EMAIL_VERIFICATION = _parse_bool("REQUIRE_EMAIL_VERIFICATION", default=True)


# --- SMTP Email Delivery Settings ---
SMTP_HOST = os.getenv("SMTP_HOST")
SMTP_PORT = _parse_int("SMTP_PORT", required=False)
SMTP_USER = os.getenv("SMTP_USER")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
SMTP_FROM_EMAIL = os.getenv("SMTP_FROM_EMAIL") or SMTP_USER
SMTP_USE_TLS = _parse_bool("SMTP_USE_TLS", default=False)
SMTP_USE_SSL = _parse_bool("SMTP_USE_SSL", default=False)
SMTP_TIMEOUT_SECONDS = _parse_int("SMTP_TIMEOUT_SECONDS", required=False) or 10

# --- HTTPS Transactional Email Settings (Resend, Brevo, SendGrid) ---
# Recommended on cloud platforms like Render where outbound SMTP ports 25, 465, and 587 are blocked
RESEND_API_KEY = os.getenv("RESEND_API_KEY")
RESEND_FROM_EMAIL = os.getenv("RESEND_FROM_EMAIL") or SMTP_FROM_EMAIL or "DocMe <onboarding@resend.dev>"

BREVO_API_KEY = os.getenv("BREVO_API_KEY")
BREVO_FROM_EMAIL = os.getenv("BREVO_FROM_EMAIL") or SMTP_FROM_EMAIL or "DocMe <noreply@docme.app>"

SENDGRID_API_KEY = os.getenv("SENDGRID_API_KEY")
SENDGRID_FROM_EMAIL = os.getenv("SENDGRID_FROM_EMAIL") or SMTP_FROM_EMAIL or "DocMe <noreply@docme.app>"
