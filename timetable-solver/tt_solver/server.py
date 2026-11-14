"""Loopback-only UI and one worker process at a time."""
import json
import mimetypes
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import urlopen
import uuid
import webbrowser
from .runner import atomic_json, read_json

APP = Path(__file__).resolve().parents[1]


def alive(pid):
    if type(pid) is not int or pid <= 0:
        return False
    if os.name == 'nt':
        import ctypes
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.OpenProcess.restype = ctypes.c_void_p
        kernel.CloseHandle.argtypes = [ctypes.c_void_p]
        handle = kernel.OpenProcess(0x1000, False, pid)
        if not handle:
            return False
        kernel.CloseHandle(handle)
        return True
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


class Runs:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.process = None
        self.active_id = None
        self.monitors = []
        self.list()

    def list(self):
        rows = []
        for path in sorted(self.root.glob('*/status.json'), reverse=True):
            try:
                status = read_json(path)
                if status['state'] == '실행 중' and not alive(status.get('pid')):
                    status['state'] = '중단됨'
                    atomic_json(path, status)
                rows.append(status)
            except (OSError, ValueError, KeyError):
                continue
        return rows

    def start(self, model, options, limits, warm_start=None):
        with self.lock:
            if any(row['state'] == '실행 중' for row in self.list()):
                raise RuntimeError('계산이 이미 실행 중입니다.')
            rid = time.strftime('%Y%m%d_%H%M%S_') + uuid.uuid4().hex[:12]
            folder = self.root/rid
            folder.mkdir()
            atomic_json(folder/'model.json', model)
            atomic_json(folder/'options.json', options)
            if warm_start is not None:
                atomic_json(folder/'warm-start.json', warm_start)
            log = (folder/'log.txt').open('ab')
            # Holding the lock until the PID is durable prevents concurrent starts.
            atomic_json(folder/'status.json', dict(id=rid, state='실행 중', pid=os.getpid(), stage='준비', stages=[]))
            try:
                command = [sys.executable, '-u', '-m', 'tt_solver', 'run', '--model', str(folder/'model.json'), '--options', str(folder/'options.json'), '--out', str(folder), '--limits', ','.join(str(n) for n in limits)]
                if warm_start is not None:
                    command.extend(['--warm-start', str(folder/'warm-start.json')])
                proc = subprocess.Popen(command, cwd=APP, stdout=log, stderr=subprocess.STDOUT)
            except Exception:
                log.close()
                atomic_json(folder/'status.json', dict(id=rid, state='ERROR', stages=[]))
                raise
            self.process = proc
            self.active_id = rid
            def watch():
                proc.wait()
                log.close()
                with self.lock:
                    status = read_json(folder/'status.json')
                    if status['state'] == '실행 중':
                        status['state'] = '중단됨'
                        atomic_json(folder/'status.json', status)
            monitor = threading.Thread(target=watch, daemon=True)
            self.monitors.append(monitor)
            monitor.start()
            return read_json(folder/'status.json')

    def cancel(self, rid):
        with self.lock:
            folder = self.root/rid
            status = read_json(folder/'status.json')
            if status['state'] == '실행 중':
                if self.process and self.active_id == rid and self.process.poll() is None:
                    self.process.terminate()
                    self.process.wait()
                    status = read_json(folder/'status.json')
                else:
                    raise RuntimeError('이전 서버의 실행입니다. 해당 콘솔을 닫고 다시 여세요.')
                status['state'] = '취소됨'
                atomic_json(folder/'status.json', status)
            return status

    def close(self):
        if self.process and self.process.poll() is None:
            self.process.terminate()
            self.process.wait()
        for monitor in self.monitors:
            monitor.join(timeout=5)


def make_server(port, root):
    runs = Runs(root)
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Uploaded model data and names do not enter server access logs.

        def reply(self, code, data, content_type='application/json; charset=utf-8'):
            body = json.dumps(data, ensure_ascii=False).encode('utf-8') if isinstance(data, (dict,list)) else data
            self.send_response(code)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Security-Policy', "default-src 'self'; style-src 'self' https://cdn.jsdelivr.net; font-src 'self' https://cdn.jsdelivr.net; frame-ancestors 'none'; base-uri 'none'")
            self.end_headers()
            self.wfile.write(body)

        def allowed(self, post=False):
            expected = f'127.0.0.1:{self.server.server_port}'
            if self.headers.get('Host') != expected:
                self.reply(403, {'error':'허용되지 않은 Host입니다.'})
                return False
            if post and (self.headers.get('Origin') not in (None, 'http://'+expected) or self.headers.get('Sec-Fetch-Site') == 'cross-site'):
                self.reply(403, {'error':'교차 Origin 요청을 거부했습니다.'})
                return False
            return True

        def do_GET(self):
            if not self.allowed():
                return
            if self.path == '/api/runs':
                self.reply(200, runs.list())
                return
            match = re.fullmatch(r'/api/runs/([0-9]{8}_[0-9]{6}_[0-9a-f]{12})(/result.xlsx)?', self.path)
            if match:
                folder = runs.root/match[1]
                try:
                    if match[2]:
                        self.reply(200, (folder/'result.xlsx').read_bytes(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
                    else:
                        runs.list()
                        self.reply(200, read_json(folder/'status.json'))
                except FileNotFoundError:
                    self.reply(404, {'error':'결과가 없습니다.'})
                return
            files = {'/':'index.html', '/app.js':'app.js', '/style.css':'style.css'}
            if self.path in files:
                path = APP/'web'/files[self.path]
                self.reply(200, path.read_bytes(), (mimetypes.guess_type(path.name)[0] or 'text/plain')+'; charset=utf-8')
            else:
                self.reply(404, {'error':'경로가 없습니다.'})

        def do_POST(self):
            if not self.allowed(True):
                return
            try:
                if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                    self.reply(415, {'error':'application/json만 허용합니다.'})
                    return
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 10*1024*1024:
                    self.reply(413, {'error':'JSON은 10MB 이하여야 합니다.'})
                    return
                payload = json.loads(self.rfile.read(length))
                if not isinstance(payload, dict):
                    raise ValueError('JSON 객체가 필요합니다.')
                if self.path == '/api/runs':
                    from .validation import validate
                    limits = payload.get('limits', [1800,600,120])
                    _, _, errors = validate(payload.get('model'), payload.get('options', {}), limits)
                    # Persist input errors as a run too, so reopening shows the diagnosis.
                    if not isinstance(limits, list) or len(limits) != 3 or any(type(n) not in (int,float) or not 0 <= n <= 86400 for n in limits):
                        raise ValueError('제한 시간 3개가 필요합니다.')
                    warm_start = payload.get('warmStart')
                    if warm_start is not None:
                        from .hints import validate_result
                        validate_result(warm_start)
                    self.reply(202, runs.start(payload.get('model'), payload.get('options', {}), limits, warm_start))
                    return
                match = re.fullmatch(r'/api/runs/([0-9]{8}_[0-9]{6}_[0-9a-f]{12})/cancel', self.path)
                if match:
                    self.reply(200, runs.cancel(match[1]))
                else:
                    self.reply(404, {'error':'경로가 없습니다.'})
            except RuntimeError as e:
                self.reply(409, {'error':str(e)})
            except FileNotFoundError:
                self.reply(404, {'error':'실행이 없습니다.'})
            except (ValueError, TypeError, KeyError):
                self.reply(400, {'error':'입력 JSON과 제한 시간을 확인하세요.'})
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.runs = runs
    return server


def serve(port, root, open_browser=False):
    url = f'http://127.0.0.1:{port}'
    if open_browser:
        try:
            with urlopen(url+'/api/runs', timeout=2) as response:
                if response.status == 200 and isinstance(json.load(response), list):
                    webbrowser.open(url)
                    return
        except (OSError, ValueError):
            pass
    server = make_server(port, root)
    if open_browser:
        webbrowser.open(url)
    print(f'{url} — 콘솔 창을 닫으면 종료합니다.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.runs.close()
        server.server_close()
