"""
Compatibility shim: config has been moved to backend.app.config.
"""
try:
    from app.config import *  # noqa: F401, F403
except ImportError:
    from backend.app.config import *  # noqa: F401, F403
