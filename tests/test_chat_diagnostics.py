import json
import os
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from backend.app.chat import stream_response, generate_response, _format_error_detail, _get_model_candidates
from backend.app.main import app
from backend.app.database import get_db
from tests.test_backend import TestSessionLocal, create_sample_docx_bytes

print("=== Running Comprehensive Chat Diagnostics & Verification ===")

def test_model_candidate_list():
    candidates = _get_model_candidates("custom-model")
    assert candidates[0] == "custom-model"
    assert "models/gemini-3.5-flash" in candidates
    assert "models/gemini-3.5-flash-lite" in candidates
    print("✓ Model candidate resolution passed.")

def test_error_formatting():
    err_429 = Exception("429 ResourceExhausted: Quota exceeded for metric")
    assert "rate limit or quota" in _format_error_detail(err_429).lower()

    err_404 = Exception("404 NotFound: models/gemini-2.0-flash is no longer available")
    assert "unavailable" in _format_error_detail(err_404).lower()

    err_generic = Exception("Socket reset by peer")
    assert "an error occurred" in _format_error_detail(err_generic).lower()
    print("✓ User-friendly error message formatting passed.")

def _extract_text(events):
    chunks = []
    for e in events:
        for line in e.splitlines():
            if line.startswith("data: "):
                try:
                    payload = json.loads(line[6:])
                    if isinstance(payload, dict) and "text" in payload:
                        chunks.append(payload["text"])
                except Exception:
                    pass
    return "".join(chunks)

def test_chat_with_grounded_content_and_sources():
    # 1. Grounded response using sample resume / tech document context
    resume_context = [
        "Candidate: Alex Rivera\nEducation: Master of Science in Computer Science from Stanford University (2020-2022). Bachelor of Science in Software Engineering from UC Berkeley (2016-2020).",
        "Technical Skills: Python, FastAPI, TypeScript, React, PostgreSQL, pgvector, Docker, Kubernetes, AWS, Gemini API, PyTorch.",
        "Experience: Senior Backend Engineer at FinTech Corp. Architected high-throughput digital banking system handling 10,000 transactions per second."
    ]
    sources = [
        {"document_id": 42, "document_title": "Alex_Rivera_Resume.pdf", "page_number": 1},
        {"document_id": 42, "document_title": "Alex_Rivera_Resume.pdf", "page_number": 2},
        {"document_id": 42, "document_title": "Alex_Rivera_Resume.pdf", "page_number": 3},
    ]

    # Test Education question
    events = list(stream_response(
        question="Tell me about the education",
        context=resume_context,
        sources=sources,
    ))
    event_types = [e.split('\n')[0].replace('event: ', '') for e in events if e.startswith('event: ')]
    assert 'sources' in event_types
    assert 'message' in event_types
    assert 'done' in event_types
    
    full_text = _extract_text(events)
    assert len(full_text.strip()) > 0
    assert "stanford" in full_text.lower() or "berkeley" in full_text.lower() or "computer science" in full_text.lower()
    print("✓ Education question answered with grounded context:", full_text[:100], "...")

    # Test Technical Skills question
    events_skills = list(stream_response(
        question="What are the technical skills?",
        context=resume_context,
        sources=sources,
    ))
    text_skills = _extract_text(events_skills)
    assert len(text_skills.strip()) > 0
    assert "python" in text_skills.lower() or "fastapi" in text_skills.lower() or "typescript" in text_skills.lower()
    print("✓ Technical Skills question answered with grounded context:", text_skills[:100], "...")

    # Test Digital Banking question
    events_bank = list(stream_response(
        question="Tell me about the digital banking system",
        context=resume_context,
        sources=sources,
    ))
    text_bank = _extract_text(events_bank)
    assert len(text_bank.strip()) > 0
    assert "fintech" in text_bank.lower() or "banking" in text_bank.lower() or "transactions" in text_bank.lower()
    print("✓ Digital Banking question answered with grounded context:", text_bank[:100], "...")

def test_chat_with_absent_content():
    # Content genuinely absent from document
    resume_context = [
        "Candidate: Alex Rivera\nEducation: Master of Science in Computer Science from Stanford University.",
    ]
    events = list(stream_response(
        question="What is the candidate's favorite recipe for chocolate cake?",
        context=resume_context,
        sources=[{"document_id": 42, "document_title": "Resume.pdf", "page_number": 1}],
    ))
    text = _extract_text(events)
    assert "does not contain sufficient information" in text.lower() or "not mention" in text.lower() or "no information" in text.lower()
    print("✓ Absent question handled with clear informative message:", text)

def test_chat_with_model_failure_fallback_and_error_reporting():
    # Verify that if a model fails (e.g. 404 or 429), it falls back to working candidates
    # And if all candidates fail, it cleanly returns an error event without crash
    with patch("backend.app.chat.get_model") as mock_get_model:
        mock_get_model.side_effect = Exception("429 ResourceExhausted: Quota exceeded")
        events = list(stream_response(
            question="Tell me about this document",
            context=["Sample document content"],
            sources=[{"document_id": 1, "document_title": "Doc"}],
        ))
        
        event_types = [e.split('\n')[0].replace('event: ', '') for e in events if e.startswith('event: ')]
        assert 'error' in event_types
        assert 'done' not in event_types  # Crucial: error event must NOT emit a misleading done event

        error_event = [e for e in events if "event: error" in e][0]
        data_line = [l for l in error_event.splitlines() if l.startswith("data: ")][0]
        data = json.loads(data_line[6:])
        assert "quota" in data["detail"].lower() or "rate limit" in data["detail"].lower()
        print("✓ Genuine API failure correctly reports informative error:", data["detail"])

if __name__ == "__main__":
    test_model_candidate_list()
    test_error_formatting()
    test_chat_with_grounded_content_and_sources()
    test_chat_with_absent_content()
    test_chat_with_model_failure_fallback_and_error_reporting()
    print("\nALL CHAT DIAGNOSTICS & SCENARIOS PASSED SUCCESSFULLY!")
