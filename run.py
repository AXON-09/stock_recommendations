"""
run.py - Single-command launcher for the Stock Recommendation System.

Usage
-----
    pip install -r backend/requirements.txt
    python run.py

Then open: http://127.0.0.1:8000
"""

import os
import sys
import webbrowser
from pathlib import Path

# Make sure we can import backend modules
ROOT = Path(__file__).parent.resolve()
sys.path.insert(0, str(ROOT / "backend"))


def main() -> None:
    try:
        import uvicorn
    except ImportError:
        print("ERROR: uvicorn is not installed.")
        print("Run:  pip install -r backend/requirements.txt")
        sys.exit(1)

    host = "127.0.0.1"
    port = 8000
    url  = f"http://{host}:{port}"

    print()
    print("=" * 56)
    print("  QuantView AI — Multi-Market Stock Analysis")
    print("  India NSE/BSE  |  US NASDAQ/NYSE")
    print("=" * 56)
    print(f"  Running at:  {url}")
    print(f"  API docs:    {url}/docs")
    print(f"  Stop:        Ctrl-C")
    print("=" * 56)
    print()

    # Open browser after a short delay (uvicorn will be ready by then)
    import threading
    def _open():
        import time; time.sleep(1.5)
        webbrowser.open(url)
    threading.Thread(target=_open, daemon=True).start()

    uvicorn.run(
        "backend.main:app",
        host=host,
        port=port,
        reload=False,
        log_level="info",
        # Use relative app path so uvicorn finds backend/main.py
        app_dir=str(ROOT),
    )


if __name__ == "__main__":
    main()
