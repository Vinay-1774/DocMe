import logging
import time
from typing import Any, List, Optional
from sqlalchemy import select
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Import centralized configuration
from .config import RETRIEVAL_LIMIT
from .database import SessionLocal
from .models import Document, DocumentChunk
from .ingestion import generate_embedding


def retrieve_documents(
    question: str,
    user_id: Optional[int] = None,
    document_id: Optional[int] = None,
    db: Optional[Session] = None,
    limit: int = RETRIEVAL_LIMIT,
) -> dict[str, Any]:
    if not question or not question.strip():
        return {"documents": [], "sources": []}

    t_start = time.perf_counter()

    # Generate query embedding vector using shared embedding provider
    query_vector = generate_embedding(question.strip())
    t_embed_ms = (time.perf_counter() - t_start) * 1000

    # Manage database session if not provided by caller
    if db is None:
        with SessionLocal() as session:
            result = _execute_vector_search(
                query_vector=query_vector,
                user_id=user_id,
                document_id=document_id,
                db=session,
                limit=limit,
            )
    else:
        result = _execute_vector_search(
            query_vector=query_vector,
            user_id=user_id,
            document_id=document_id,
            db=db,
            limit=limit,
        )

    t_total_ms = (time.perf_counter() - t_start) * 1000
    logger.info(
        "Retrieval stage timing: embedding=%.2fms, total_retrieval=%.2fms, chunks_retrieved=%d",
        t_embed_ms,
        t_total_ms,
        len(result.get("documents", [])),
    )
    return result


def _execute_vector_search(
    query_vector: List[float],
    user_id: Optional[int],
    document_id: Optional[int],
    db: Session,
    limit: int,
) -> dict[str, Any]:
    """
    Executes the pgvector cosine similarity search with database-level authorization.
    """
    t_search_start = time.perf_counter()

    # Authorization filter:
    # 1. Any public document is accessible.
    # 2. If authenticated (user_id provided), the user's own private documents are accessible.
    if user_id is not None:
        access_filter = (Document.visibility == "public") | (Document.user_id == user_id)
    else:
        access_filter = (Document.visibility == "public")

    # Filter out chunks without embeddings and apply authorization
    stmt = (
        select(DocumentChunk, Document)
        .join(Document, DocumentChunk.document_id == Document.id)
        .where(access_filter)
        .where(DocumentChunk.embedding.is_not(None))
    )

    # Restrict to specific target document if provided
    if document_id is not None:
        stmt = stmt.where(Document.id == document_id)

    # Order by cosine distance (smallest distance = highest similarity)
    stmt = stmt.order_by(DocumentChunk.embedding.cosine_distance(query_vector)).limit(limit)

    results = db.execute(stmt).all()
    t_search_ms = (time.perf_counter() - t_search_start) * 1000
    logger.info("pgvector cosine similarity query completed in %.2fms", t_search_ms)

    if not results:
        return {"documents": [], "sources": []}

    documents: List[str] = []
    sources: List[dict[str, Any]] = []

    for chunk, doc in results:
        documents.append(chunk.content)
        sources.append({
            "document_id": doc.id,
            "document_title": doc.title,
            "chunk_index": chunk.chunk_index,
            "page_number": chunk.page_number,
        })

    return {
        "documents": documents,
        "sources": sources,
    }
