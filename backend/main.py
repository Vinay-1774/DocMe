"""
Compatibility shim: main has been moved to backend.app.main.
"""
try:
    from app.main import *  # noqa: F401, F403
except ImportError:
    from backend.app.main import *  # noqa: F401, F403
