"""Run SimpleCanvas locally using the built files and Python's standard library."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import urlopen
import sys
import webbrowser

ROOT = Path(__file__).resolve().parent / "dist" / "canvas"
URL = "http://127.0.0.1:8766/"

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

def main():
    if not (ROOT / "index.html").is_file():
        raise SystemExit("ビルドがありません。npm run build:canvas を実行してください。")
    try:
        server = ThreadingHTTPServer(("127.0.0.1", 8766), partial(Handler, directory=str(ROOT)))
    except OSError:
        try:
            with urlopen(URL, timeout=2) as response:
                is_canvas = "<title>SimpleCanvas</title>" in response.read(10000).decode("utf-8")
            if is_canvas:
                print("SimpleCanvasはすでに起動しています。" + URL)
                if "--no-open" not in sys.argv:
                    webbrowser.open(URL)
                return
        except Exception:
            pass
        raise SystemExit("ポート8766を他のアプリが使用しています。終了してから再実行してください。")
    print("SimpleCanvas: " + URL, flush=True)
    print("終了するには、このウィンドウで Ctrl+C を押してください。", flush=True)
    if "--no-open" not in sys.argv:
        webbrowser.open(URL)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__ == "__main__":
    main()
