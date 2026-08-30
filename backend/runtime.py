"""
runtime.py — production hardening primitives for the QuantView AI backend.

Provides:
  * TTLLRUCache      — bounded, thread-safe model cache (prevents unbounded RAM growth)
  * training_lock()  — per-ticker lock so N concurrent requests train a ticker only once
  * TRAIN_SEMAPHORE  — global cap on simultaneous model training jobs (CPU protection)
  * RateLimitMiddleware — dependency-free sliding-window IP rate limiter
  * allowed_origins() — CORS origins from env instead of a blanket "*"

All of these are stdlib-only, so requirements.txt is unchanged.
"""

from __future__ import annotations

import os
import threading
import time
from collections import OrderedDict, defaultdict, deque
from typing import Any, Deque, Dict, Iterator, Optional, Tuple

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

# ---------------------------------------------------------------------------
# Tunables (env-overridable)
# ---------------------------------------------------------------------------
MAX_CACHED_MODELS   = int(os.getenv("MAX_CACHED_MODELS", "32"))
MAX_CONCURRENT_FITS = int(os.getenv("MAX_CONCURRENT_FITS", "2"))
RATE_LIMIT_REQUESTS = int(os.getenv("RATE_LIMIT_REQUESTS", "60"))
RATE_LIMIT_WINDOW_S = int(os.getenv("RATE_LIMIT_WINDOW_S", "60"))
HEAVY_LIMIT_REQUESTS = int(os.getenv("HEAVY_LIMIT_REQUESTS", "10"))
HEAVY_LIMIT_WINDOW_S = int(os.getenv("HEAVY_LIMIT_WINDOW_S", "60"))


# ---------------------------------------------------------------------------
# Bounded, thread-safe cache with a dict-compatible surface
# ---------------------------------------------------------------------------
class TTLLRUCache:
    """Drop-in replacement for the previous plain ``dict`` model cache.

    Bounded to ``maxsize`` entries with least-recently-used eviction, and
    guarded by a lock so concurrent requests cannot corrupt it.
    Staleness itself is still decided by ``CacheEntry.is_stale``.
    """

    def __init__(self, maxsize: int = MAX_CACHED_MODELS) -> None:
        self._maxsize = max(1, maxsize)
        self._data: "OrderedDict[str, Any]" = OrderedDict()
        self._lock = threading.RLock()

    def __contains__(self, key: str) -> bool:
        with self._lock:
            return key in self._data

    def __getitem__(self, key: str) -> Any:
        with self._lock:
            value = self._data[key]
            self._data.move_to_end(key)
            return value

    def __setitem__(self, key: str, value: Any) -> None:
        with self._lock:
            self._data[key] = value
            self._data.move_to_end(key)
            while len(self._data) > self._maxsize:
                self._data.popitem(last=False)  # evict LRU

    def __len__(self) -> int:
        with self._lock:
            return len(self._data)

    def __iter__(self) -> Iterator[str]:
        with self._lock:
            return iter(list(self._data.keys()))

    def get(self, key: str, default: Any = None) -> Any:
        with self._lock:
            return self._data.get(key, default)

    def pop(self, key: str, default: Any = None) -> Any:
        with self._lock:
            return self._data.pop(key, default)

    def keys(self):
        with self._lock:
            return list(self._data.keys())

    def items(self):
        with self._lock:
            return list(self._data.items())

    def clear(self) -> None:
        with self._lock:
            self._data.clear()


# ---------------------------------------------------------------------------
# Per-ticker training locks + global concurrency cap
# ---------------------------------------------------------------------------
_locks: Dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()

#: Caps how many XGBoost/LSTM fits may run at once across the whole process.
TRAIN_SEMAPHORE = threading.BoundedSemaphore(max(1, MAX_CONCURRENT_FITS))


def training_lock(ticker: str) -> threading.Lock:
    """Return the process-wide lock for ``ticker``.

    Two requests for the same ticker arriving together now train once; the
    second waits and then reads the warm cache entry.
    """
    with _locks_guard:
        lock = _locks.get(ticker)
        if lock is None:
            lock = threading.Lock()
            _locks[ticker] = lock
        return lock


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------
def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Sliding-window per-IP rate limiter.

    Two buckets: a general one for every ``/api/`` call, and a much stricter
    one for the expensive training endpoints, which are the real DoS surface.
    """

    HEAVY_PREFIXES: Tuple[str, ...] = ("/api/recommend", "/api/backtest")

    def __init__(self, app) -> None:
        super().__init__(app)
        self._hits: Dict[str, Deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _allow(self, key: str, limit: int, window: int) -> bool:
        now = time.monotonic()
        with self._lock:
            bucket = self._hits[key]
            while bucket and now - bucket[0] > window:
                bucket.popleft()
            if len(bucket) >= limit:
                return False
            bucket.append(now)
            return True

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if path.startswith("/api/"):
            ip = _client_ip(request)
            heavy = path.startswith(self.HEAVY_PREFIXES)
            checks = [(f"all:{ip}", RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW_S)]
            if heavy:
                checks.append((f"heavy:{ip}", HEAVY_LIMIT_REQUESTS, HEAVY_LIMIT_WINDOW_S))
            for key, limit, window in checks:
                if not self._allow(key, limit, window):
                    return JSONResponse(
                        status_code=429,
                        content={
                            "detail": "Rate limit exceeded. Model training is CPU-bound; "
                                      "please slow down and retry shortly."
                        },
                        headers={"Retry-After": str(window)},
                    )
        return await call_next(request)


# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
def allowed_origins() -> list[str]:
    """Comma-separated ``ALLOWED_ORIGINS`` env var, defaulting to ``*``.

    Set ALLOWED_ORIGINS=https://your-app.onrender.com in production.
    """
    raw = os.getenv("ALLOWED_ORIGINS", "").strip()
    if not raw:
        return ["*"]
    return [o.strip() for o in raw.split(",") if o.strip()]
