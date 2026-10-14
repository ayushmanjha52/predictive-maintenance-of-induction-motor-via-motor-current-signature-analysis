"""Vercel entry point: the FastAPI app in backend/, mounted under /api.

The static site is served by Vercel's CDN; only /api/* reaches this function.
"""

import os
import sys
from pathlib import Path

for key, value in {
    "APP_ENV": "production",
    "API_PREFIX": "/api",
    "ALLOWED_HOSTS": "*.vercel.app",
    "MAX_UPLOAD_MB": "4",  # Vercel caps function request bodies at 4.5 MB
    "TRUST_PROXY_HEADERS": "true",  # Vercel sets X-Real-IP / X-Forwarded-For itself
    "ENABLE_HSTS": "true",
}.items():
    os.environ.setdefault(key, value)

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from main import app  # noqa: E402,F401
