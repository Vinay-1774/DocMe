import hashlib
import logging
import os
from typing import Any, List

logger = logging.getLogger(__name__)

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import CHUNK_OVERLAP, CHUNK_SIZE, GEMINI_API_KEY, GEMINI_EMBEDDING_MODEL

try:
    from pypdf import PdfReader
except ImportError:
    PdfReader = None

try:
    from docx import Document as DocxDocument
except ImportError:
    DocxDocument = None

try:
    import google.generativeai as genai
except ImportError:
    genai = None

from .models import DocumentChunk


SUPPORTED_EXTENSIONS = {".pdf", ".docx",".jpg",".jpeg",".png"}


def compute_file_hash(file_path: str) -> str:
    sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(8192):
            sha256.update(chunk)
    return sha256.hexdigest()


def extract_text_and_metadata(file_path: str) -> List[dict[str, Any]]:
    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    _, ext = os.path.splitext(file_path.lower())
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(
            f"Unsupported file format '{ext}'. Only PDF (.pdf) and DOCX (.docx) files are supported."
        )

    sections: List[dict[str, Any]] = []

    if ext == ".pdf":
        if PdfReader is None:
            raise ImportError("pypdf is not installed. Please install it with `pip install pypdf`.")
        try:
            reader = PdfReader(file_path)
            for page_idx, page in enumerate(reader.pages, start=1):
                text = page.extract_text() or ""
                if text.strip():
                    sections.append({"text": text, "page_number": page_idx})
        except Exception as e:
            raise ValueError(f"Failed to read PDF file '{file_path}': {e}") from e

    elif ext == ".docx":
        if DocxDocument is None:
            raise ImportError("python-docx is not installed. Please install it with `pip install python-docx`.")
        try:
            doc = DocxDocument(file_path)
            paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
            full_text = "\n".join(paragraphs)
            if full_text.strip():
                sections.append({"text": full_text, "page_number": None})
        except Exception as e:
            raise ValueError(f"Failed to read DOCX file '{file_path}': {e}") from e

    if not sections or not any(s["text"].strip() for s in sections):
        raise ValueError(f"Document '{file_path}' is empty or unreadable.")

    return sections


def chunk_text(
    text: str,
    chunk_size: int = CHUNK_SIZE,
    chunk_overlap: int = CHUNK_OVERLAP,
) -> List[str]:
    if not text or not text.strip():
        return []
    if chunk_size <= chunk_overlap:
        raise ValueError("chunk_size must be strictly greater than chunk_overlap.")

    cleaned_text = " ".join(text.split())
    chunks: List[str] = []
    start = 0
    text_len = len(cleaned_text)
    step = chunk_size - chunk_overlap

    while start < text_len:
        end = start + chunk_size
        chunk = cleaned_text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start += step

    return chunks


def chunk_document_sections(
    sections: List[dict[str, Any]],
    chunk_size: int = CHUNK_SIZE,
    chunk_overlap: int = CHUNK_OVERLAP,
) -> List[dict[str, Any]]:
    """Splits extracted sections into structured chunks with preserved page metadata."""
    chunks: List[dict[str, Any]] = []
    chunk_index = 0

    for section in sections:
        page_number = section.get("page_number")
        text = section.get("text", "")
        text_chunks = chunk_text(text, chunk_size=chunk_size, chunk_overlap=chunk_overlap)

        for text_chunk in text_chunks:
            chunks.append({
                "chunk_index": chunk_index,
                "content": text_chunk,
                "page_number": page_number,
            })
            chunk_index += 1

    return chunks


def generate_embedding(text: str) -> List[float]:
    """Generates a vector embedding for a single text chunk using Gemini text embedding."""
    if not GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY is not configured in environment or .env.")

    if genai is None:
        raise ImportError("google-generativeai is not installed.")

    genai.configure(api_key=GEMINI_API_KEY)
    response = genai.embed_content(
        model=GEMINI_EMBEDDING_MODEL,
        content=text,
        output_dimensionality=768,
    )
    return response["embedding"]


def generate_embeddings(texts: List[str]) -> List[List[float]]:
    if not GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY is not configured in environment or .env.")

    if genai is None:
        raise ImportError("google-generativeai is not installed.")

    genai.configure(api_key=GEMINI_API_KEY)
    response = genai.embed_content(
        model=GEMINI_EMBEDDING_MODEL,
        content=texts,
        output_dimensionality=768,
    )
    return response["embedding"]


class BatchEmbeddingUnsupportedError(Exception):
    """Raised when the provider endpoint or SDK does not support batch embedding."""
    pass


def is_batch_unsupported_error(exc: Exception) -> bool:
    """
    Determines if an exception specifically indicates that batch embedding is unsupported
    (e.g., SDK type error or provider limitation on batch inputs), as opposed to genuine
    quota, authentication, network, or server errors.
    """
    if isinstance(exc, (TypeError, BatchEmbeddingUnsupportedError)):
        return True

    exc_name = exc.__class__.__name__
    exc_msg = str(exc).lower()

    # Quota, authentication, timeout, or server errors MUST NEVER be treated as batch incompatibility
    non_retryable_names = {
        "ResourceExhausted",
        "Unauthenticated",
        "PermissionDenied",
        "DeadlineExceeded",
        "ServiceUnavailable",
        "InternalServerError",
    }
    if exc_name in non_retryable_names:
        return False

    if exc_name == "InvalidArgument" and "batch" in exc_msg:
        return True

    return False


def store_chunks(
    chunks: List[dict[str, Any]],
    document_id: int,
    user_id: int,
    db: Session,
) -> int:
    try:
        for item in chunks:
            chunk_obj = DocumentChunk(
                document_id=document_id,
                user_id=user_id,
                content=item["content"],
                chunk_index=item["chunk_index"],
                page_number=item.get("page_number"),
                embedding=item.get("embedding"),
            )
            db.add(chunk_obj)

        db.commit()
        return len(chunks)
    except Exception:
        db.rollback()
        raise


def ingest_document(
    file_path: str,
    document_id: int,
    user_id: int,
    db: Session,
    chunk_size: int = CHUNK_SIZE,
    chunk_overlap: int = CHUNK_OVERLAP,
) -> dict[str, Any]:
    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    # Check if chunks have already been stored in the database for this specific document
    existing_count = db.scalar(
        select(func.count(DocumentChunk.id)).where(DocumentChunk.document_id == document_id)
    ) or 0
    if existing_count > 0:
        return {
            "status": "already_ingested",
            "document_id": document_id,
            "user_id": user_id,
            "chunks_count": existing_count,
        }

    # Extract text and page metadata
    sections = extract_text_and_metadata(file_path)

    # Split into chunks
    chunks = chunk_document_sections(sections, chunk_size=chunk_size, chunk_overlap=chunk_overlap)
    if not chunks:
        raise ValueError(f"No text chunks could be extracted from document.")

    # Generate embeddings
    chunk_texts = [c["content"] for c in chunks]
    try:
        embeddings = generate_embeddings(chunk_texts)
        for chunk, emb in zip(chunks, embeddings):
            chunk["embedding"] = emb
    except Exception as err:
        if is_batch_unsupported_error(err):
            logger.warning(
                "Batch embedding is unsupported by provider (%s); falling back to sequential generation.",
                err,
            )
            for chunk in chunks:
                chunk["embedding"] = generate_embedding(chunk["content"])
        else:
            # Genuine provider failure (quota, auth, network, invalid arg) - propagate immediately
            raise

    # Persist chunks and embeddings in PostgreSQL
    stored_count = store_chunks(chunks, document_id=document_id, user_id=user_id, db=db)

    return {
        "status": "success",
        "document_id": document_id,
        "user_id": user_id,
        "chunks_count": stored_count,
    }
