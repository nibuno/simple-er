"""Local-only static server. No packages or external services are required."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import urlopen
import webbrowser
import sys

ROOT = Path(__file__).resolve().parent / 'dist'
URL = 'http://127.0.0.1:8765/'

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

def main():
    try:
        server = ThreadingHTTPServer(('127.0.0.1', 8765), partial(Handler, directory=str(ROOT)))
    except OSError:
        try:
            with urlopen(URL, timeout=2) as response:
                is_editor = '<title>SimpleER</title>' in response.read(10000).decode('utf-8')
            if is_editor:
                print('SimpleERはすでに起動しています。' + URL)
                if '--no-open' not in sys.argv:
                    webbrowser.open(URL)
                return
        except Exception:
            pass
        raise SystemExit('ポート8765を他のアプリが使用しています。終了してから再実行してください。')
    print('SimpleER: ' + URL, flush=True)
    print('終了するには、このウィンドウで Ctrl+C を押してください。', flush=True)
    if '--no-open' not in sys.argv:
        webbrowser.open(URL)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__ == '__main__':
    main()
