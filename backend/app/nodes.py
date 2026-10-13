import logging
import time
from typing import Any, List, Optional, TypedDict
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Import retrieval functionality from retrieval.py
try:
    from app.retrieval import retrieve_documents
except ImportError:
    try:
        from backend.app.retrieval import retrieve_documents
    except ImportError:
        from retrieval import retrieve_documents

# Import response generation functionality from chat.py
try:
    from app.chat import generate_response
except ImportError:
    try:
        from backend.app.chat import generate_response
    except ImportError:
        from chat import generate_response


class GraphState(TypedDict, total=False):
    """
    Shared typed state for the document question-answering workflow.
    """
    question: str
    user_id: Optional[int]
    document_id: Optional[int]
    db: Optional[Session]
    documents: List[str]
    answer: str
    sources: Optional[List[dict[str, Any]]]


def retrieve_node(state: GraphState) -> dict:
    """
    Retrieval node: retrieves relevant document chunks and optional source
    metadata for the question, user_id, and document_id from the retrieval module.
    """
    t_start = time.perf_counter()
    question = state.get("question", "")
    user_id = state.get("user_id")
    document_id = state.get("document_id")
    db = state.get("db")

    result = retrieve_documents(
        question=question,
        user_id=user_id,
        document_id=document_id,
        db=db,
    )

    documents = result.get("documents") or result.get("chunks", [])
    sources = result.get("sources", [])

    t_node_ms = (time.perf_counter() - t_start) * 1000
    logger.info("LangGraph node [retrieve] executed in %.2fms", t_node_ms)

    return {
        "documents": documents,
        "sources": sources,
    }


def generate_node(state: GraphState) -> dict:
    """
    Response-generation node: passes the question and retrieved context
    to the chat module to generate an answer.
    """
    t_start = time.perf_counter()
    question = state.get("question", "")
    documents = state.get("documents", [])
    sources = state.get("sources", [])

    try:
        answer = generate_response(question=question, context=documents, sources=sources)
    except TypeError:
        answer = generate_response(question=question, context=documents)

    t_node_ms = (time.perf_counter() - t_start) * 1000
    logger.info("LangGraph node [generate] executed in %.2fms", t_node_ms)

    return {
        "answer": answer,
    }
