#!/usr/bin/env python3
"""BOM-to-Cart log server — receives log entries from Chrome extension via HTTP POST
and writes them to /root/bom-to-cart/logs/YYYY-MM-DD.log.

Usage: python3 /root/bom-to-cart/log-server.py [--port 8666]
"""
import json, os, sys
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler

LOG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs')

class LogHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != '/log':
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length).decode('utf-8')

        try:
            entry = json.loads(body)
        except json.JSONDecodeError:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b'{"error":"invalid json"}')
            return

        # Extract fields
        ts = entry.get('ts', datetime.now().isoformat())
        level = entry.get('level', 'info')
        msg = entry.get('msg', '')
        part = entry.get('part', '')

        # Build log line
        timestamp = ts[:19].replace('T', ' ') if 'T' in ts else ts
        part_str = f' [{part}]' if part else ''
        line = f'{timestamp} [{level.upper():>5}]{part_str} {msg}\n'

        # Write to daily log file
        os.makedirs(LOG_DIR, exist_ok=True)
        date_str = datetime.now().strftime('%Y-%m-%d')
        log_path = os.path.join(LOG_DIR, f'{date_str}.log')
        with open(log_path, 'a') as f:
            f.write(line)

        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def log_message(self, format, *args):
        pass  # suppress default stderr logging


if __name__ == '__main__':
    port = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[1] == '--port' else 8666
    server = HTTPServer(('127.0.0.1', port), LogHandler)
    print(f'[log-server] Listening on 127.0.0.1:{port} → {LOG_DIR}/')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n[log-server] Stopped.')