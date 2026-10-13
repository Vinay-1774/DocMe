"""
Root entrypoint for the Research Platform backend.
Enables running `uvicorn main:app --reload` directly from the project root.
"""
import sys
from pathlib import Path

# Ensure backend directory is in python module path
BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

try:
    from backend.app.main import app  # noqa: F401
except ImportError:
    from backend.main import app  # noqa: F401

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
