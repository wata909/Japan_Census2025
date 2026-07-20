import http.server, os

class BoundedFile:
    """開始位置から length バイトだけ read できるファイルラッパー。"""
    def __init__(self, f, length):
        self.f = f; self.remaining = length
    def read(self, n=-1):
        if self.remaining <= 0: return b''
        if n is None or n < 0: n = self.remaining
        chunk = self.f.read(min(n, self.remaining))
        self.remaining -= len(chunk)
        return chunk
    def close(self): self.f.close()

class H(http.server.SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def send_head(self):
        path = self.translate_path(self.path)
        if not os.path.isfile(path):
            return super().send_head()
        ctype = self.guess_type(path)
        fs = os.path.getsize(path)
        f = open(path, 'rb')
        rng = self.headers.get('Range')
        if rng and rng.startswith('bytes='):
            try:
                s, e = rng[6:].split('-')
                start = int(s) if s else 0
                end = int(e) if e else fs - 1
            except ValueError:
                start, end = 0, fs - 1
            start = max(0, start); end = min(end, fs - 1)
            length = end - start + 1
            f.seek(start)
            self.send_response(206)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Range', f'bytes {start}-{end}/{fs}')
            self.send_header('Content-Length', str(length))
            self.send_header('Accept-Ranges', 'bytes')
            self.end_headers()
            return BoundedFile(f, length)
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(fs))
        self.send_header('Accept-Ranges', 'bytes')
        self.end_headers()
        return f

http.server.ThreadingHTTPServer(('127.0.0.1', 8899), H).serve_forever()
