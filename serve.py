#!/usr/bin/env python3
"""Zero-dependency local server for Anaglyph Studio.

    python serve.py            # picks a free port, opens your browser
    python serve.py 3000       # use port 3000
    python serve.py --no-open  # do not launch a browser

Works with `python`, `python3` or `py -3`. Nothing to install.
For people who have Python but not Node; serve.mjs is the Node equivalent.
"""
import http.server
import os
import socket
import sys
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
APP = "/anaglyph-studio/"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):  # keep the console quiet
        pass


def main():
    argv = sys.argv[1:]
    no_open = "--no-open" in argv
    ports = [int(a) for a in argv if a.isdigit()]
    port = ports[0] if ports else 8000

    httpd = None
    for candidate in range(port, port + 20):
        try:
            httpd = http.server.ThreadingHTTPServer(("", candidate), Handler)
            port = candidate
            break
        except OSError:
            print("  port %d is busy, trying %d..." % (candidate, candidate + 1))
    if httpd is None:
        print("\n  Could not find a free port. Try: python serve.py 9000\n")
        return 1

    url = "http://localhost:%d%s" % (port, APP)
    print("\n  Anaglyph Studio is running.\n")
    print("    " + url)
    try:
        lan = socket.gethostbyname(socket.gethostname())
        if not lan.startswith("127."):
            print("    http://%s:%d%s   (from another device)" % (lan, port, APP))
    except Exception:
        pass
    print("\n  Press Ctrl+C to stop.\n")

    if not no_open:
        try:
            webbrowser.open(url)
        except Exception:
            pass
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopped.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
