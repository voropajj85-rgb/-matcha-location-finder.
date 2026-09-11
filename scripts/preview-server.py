"""Serve the repository's frontend files for LAN/temporary tunnel previews."""
import argparse
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DIRS = {"js", "css", "data", "assets"}


class PreviewHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".css": "text/css"}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_head(self):
        # Keep the repository root as the document root, but never expose Git,
        # environment files, scripts, reports, or symlinks outside public assets.
        target = Path(self.translate_path(self.path)).resolve()
        try:
            parts = target.relative_to(ROOT).parts
        except ValueError:
            parts = ("blocked",)
        allowed = not parts or parts == ("index.html",) or (
            parts[0] in PUBLIC_DIRS and all(not part.startswith(".") for part in parts))
        if not allowed:
            self.send_error(403, "Not a public preview asset")
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(403, "Directory listing disabled")
        return None

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=4173)
    args = parser.parse_args()
    if not (ROOT / "index.html").is_file():
        parser.error("index.html was not found at the repository root")
    with ThreadingHTTPServer(("0.0.0.0", args.port), PreviewHandler) as server:
        print(f"Document root: {ROOT}", flush=True)
        print(f"Listening on all IPv4 interfaces, port {args.port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
