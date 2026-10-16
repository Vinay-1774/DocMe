import json
import logging
import time
from typing import Any, Generator, List, Optional

logger = logging.getLogger(__name__)

# Import centralized configuration
from .config import GEMINI_API_KEY, GEMINI_CHAT_MODEL

try:
    import google.generativeai as genai
except ImportError:
    genai = None


SYSTEM_INSTRUCTION = (
    "You are a helpful research assistant for answering questions about documents. "
    "Generate a concise, natural answer grounded strictly in the provided document context. "
    "Do not invent facts or extrapolate beyond what is stated in the context. "
    "If the provided context does not contain sufficient information to answer the question, clearly state: "
    "'The provided document context does not contain sufficient information to answer this question.' "
    "When possible, preserve and mention source citations (such as document title or page number). "
    "Format your answer cleanly using standard Markdown with structured paragraphs, bullet points, or section headings where appropriate. "
    "Keep answers concise by default and avoid forced formatting when a short direct answer is more suitable."
)


def get_model(api_key: Optional[str] = None, model_name: Optional[str] = None):
    """Initializes and returns the Gemini GenerativeModel instance."""
    if genai is None:
        raise ImportError(
            "google-generativeai is not installed. Please install it using `pip install google-generativeai`."
        )

    key = api_key or GEMINI_API_KEY
    if not key:
        raise ValueError(
            "GEMINI_API_KEY is not configured. Please set GEMINI_API_KEY in .env or the environment."
        )

    genai.configure(api_key=key)
    name = model_name or GEMINI_CHAT_MODEL

    return genai.GenerativeModel(
        model_name=name,
        system_instruction=SYSTEM_INSTRUCTION,
    )


def build_prompt(
    question: str,
    context: List[str],
    sources: Optional[List[dict[str, Any]]] = None,
) -> str:
    """
    Combines retrieved document chunks and optional source metadata with the user question into a prompt.
    """
    if not context:
        context_block = "No relevant document context found."
    else:
        formatted_chunks = []
        for i, chunk in enumerate(context, start=1):
            source_tag = ""
            if sources and i - 1 < len(sources):
                src = sources[i - 1]
                title = src.get("document_title") or src.get("title") or f"Document {src.get('document_id', '')}"
                page = src.get("page_number")
                if page:
                    source_tag = f" (Source: {title}, Page {page})"
                elif title:
                    source_tag = f" (Source: {title})"

            formatted_chunks.append(f"[Context {i}{source_tag}]\n{chunk.strip()}")
        context_block = "\n\n".join(formatted_chunks)

    return (
        f"Context:\n{context_block}\n\n"
        f"Question: {question.strip()}\n\n"
        "Answer:"
    )


def generate_response(
    question: str,
    context: List[str],
    sources: Optional[List[dict[str, Any]]] = None,
    api_key: Optional[str] = None,
    model_name: Optional[str] = None,
) -> str:
    """
    Generates a conversational, grounded answer to the question using retrieved document context.
    Matches the interface called by nodes.py:
        generate_response(question=question, context=documents) -> str
    """
    if not question or not question.strip():
        return "Please provide a valid question."

    if not context or not any(c.strip() for c in context):
        return "The provided document context does not contain sufficient information to answer this question."

    t_start = time.perf_counter()
    prompt = build_prompt(question=question, context=context, sources=sources)
    model = get_model(api_key=api_key, model_name=model_name)
    response = model.generate_content(prompt)
    t_gen_ms = (time.perf_counter() - t_start) * 1000
    logger.info("Non-streaming LLM response generated in %.2fms", t_gen_ms)

    if not response.text:
        return "The provided document context does not contain sufficient information to answer this question."

    return response.text.strip()


def stream_response(
    question: str,
    context: List[str],
    sources: Optional[List[dict[str, Any]]] = None,
    api_key: Optional[str] = None,
    model_name: Optional[str] = None,
) -> Generator[str, None, None]:
    """
    Yields genuine streaming tokens formatted as Server-Sent Events (SSE).
    Sends source metadata first, followed by message tokens, and terminates with a completion event.
    """
    if not question or not question.strip():
        yield f"event: error\ndata: {json.dumps({'detail': 'Question cannot be empty.'})}\n\n"
        return

    # If context is empty or insufficient, return an informational event followed by completion
    if not context or not any(c.strip() for c in context):
        if sources:
            yield f"event: sources\ndata: {json.dumps(sources)}\n\n"
        yield f"event: message\ndata: {json.dumps({'text': 'The provided document context does not contain sufficient information to answer this question.'})}\n\n"
        yield f"event: done\ndata: {json.dumps({'status': 'completed'})}\n\n"
        return

    # 1. Send sources event if metadata is available
    if sources:
        yield f"event: sources\ndata: {json.dumps(sources)}\n\n"

    # 2. Stream tokens from the model provider with TTFT tracking
    t_stream_start = time.perf_counter()
    first_token_time = None
    chunk_count = 0

    try:
        prompt = build_prompt(question=question, context=context, sources=sources)
        model = get_model(api_key=api_key, model_name=model_name)
        response = model.generate_content(prompt, stream=True)

        for chunk in response:
            text = getattr(chunk, "text", None)
            if text:
                if first_token_time is None:
                    first_token_time = time.perf_counter()
                    ttft_ms = (first_token_time - t_stream_start) * 1000
                    logger.info("Streaming TTFT (Time To First Token): %.2fms", ttft_ms)
                chunk_count += 1
                yield f"event: message\ndata: {json.dumps({'text': text})}\n\n"

        total_stream_ms = (time.perf_counter() - t_stream_start) * 1000
        logger.info(
            "Streaming completed in %.2fms (%d chunks generated)",
            total_stream_ms,
            chunk_count,
        )

        # 3. Clear completion event
        yield f"event: done\ndata: {json.dumps({'status': 'completed'})}\n\n"
    except Exception as e:
        logger.error("Streaming generation failed: %s", e, exc_info=True)
        yield f"event: error\ndata: {json.dumps({'detail': 'An error occurred during response generation.'})}\n\n"
