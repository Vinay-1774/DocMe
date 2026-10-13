"""
backend/app/semantic-search.py
Dedicated semantic document search module using PostgreSQL pgvector and keyword matching.

NOTE: This file has a hyphen in its filename ('semantic-search.py'), which is not a valid
Python identifier for direct `import app.semantic-search`. To import this module cleanly
without duplicating its logic, use `importlib.util.spec_from_file_location`.
"""
import logging
from typing import List, Optional
from sqlalchemy import select, func, or_
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Import database models
try:
    from app.models import Document, DocumentChunk
except ImportError:
    try:
        from backend.app.models import Document, DocumentChunk
    except ImportError:
        from models import Document, DocumentChunk

# Reuse existing shared embedding generation from ingestion.py
try:
    from app.ingestion import generate_embedding
except ImportError:
    try:
        from backend.app.ingestion import generate_embedding
    except ImportError:
        from ingestion import generate_embedding


def perform_semantic_search(
    query: str,
    db: Session,
    user_id: Optional[int] = None,
    limit: int = 10,
    distance_threshold: float = 0.65,
) -> List[Document]:
    """
    Searches for related documents by title/description keywords and pgvector semantic similarity.
    Enforces strict access control:
    - Public documents are discoverable by anyone.
    - Private documents are ONLY discoverable by their owner (matching user_id).
    - Other users' private documents are never revealed.

    Parameters:
        query: User search text
        db: SQLAlchemy database session
        user_id: Optional authenticated user ID
        limit: Maximum results to return (default 10)
        distance_threshold: Maximum pgvector cosine distance to qualify as a semantic match (default 0.65)

    Returns:
        List of Document model instances with real metadata.
    """
    clean_query = (query or "").strip()
    if not clean_query:
        return []

    # 1. Access Control Filter
    if user_id is not None:
        access_filter = or_(Document.visibility == "public", Document.user_id == user_id)
    else:
        access_filter = (Document.visibility == "public")

    # 2. Keyword Match on Title and Description
    keyword_stmt = (
        select(Document)
        .where(access_filter)
        .where(
            or_(
                Document.title.ilike(f"%{clean_query}%"),
                Document.description.ilike(f"%{clean_query}%"),
            )
        )
        .order_by(Document.created_at.desc())
        .limit(limit)
    )
    keyword_docs = list(db.scalars(keyword_stmt).all())
    seen_doc_ids = {doc.id for doc in keyword_docs}
    combined_results = list(keyword_docs)

    # 3. Pgvector Semantic Vector Similarity Search
    remaining_slots = limit - len(combined_results)
    if remaining_slots > 0:
        try:
            query_vector = generate_embedding(clean_query)
            if query_vector:
                dist_expr = DocumentChunk.embedding.cosine_distance(query_vector)
                semantic_stmt = (
                    select(
                        DocumentChunk.document_id,
                        func.min(dist_expr).label("min_distance"),
                    )
                    .join(Document, DocumentChunk.document_id == Document.id)
                    .where(access_filter)
                    .where(DocumentChunk.embedding.is_not(None))
                    .where(dist_expr < distance_threshold)
                )
                if seen_doc_ids:
                    semantic_stmt = semantic_stmt.where(
                        DocumentChunk.document_id.not_in(seen_doc_ids)
                    )

                semantic_stmt = (
                    semantic_stmt.group_by(DocumentChunk.document_id)
                    .order_by("min_distance")
                    .limit(remaining_slots)
                )
                semantic_rows = db.execute(semantic_stmt).all()

                for row in semantic_rows:
                    doc = db.scalar(select(Document).where(Document.id == row.document_id))
                    if doc and doc.id not in seen_doc_ids:
                        seen_doc_ids.add(doc.id)
                        combined_results.append(doc)
        except Exception as e:
            logger.warning("Semantic vector search failed for query '%s': %s", clean_query, e)

    return combined_results


# Alias for compatibility with varying function name expectations
search_documents = perform_semantic_search
