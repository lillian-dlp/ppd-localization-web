#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PPD 本地化测试工具 — 本地服务端 (仅依赖 Python 标准库)

职责:
  * 提供静态页面 (index.html 及样例文件)
  * 从 CUPS 读取打印机列表          GET  /api/printers
  * 读取某台打印机的 PPD 原文        GET  /api/ppd?name=<队列名>
  * 读取任意路径的 PPD (可选)        GET  /api/ppd?path=<文件路径>

PPD 解析与基线比对、截断检测均在前端完成, 因此即使不连 CUPS,
也可在页面里手动导入 PPD 文件离线使用。

启动:
    python3 server.py            # 默认 http://127.0.0.1:4173/
    python3 server.py 8080       # 指定端口
"""

import os
import re
import sys
import json
import glob
import subprocess
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    import xlsx_baseline
except Exception:
    xlsx_baseline = None

ROOT = os.path.dirname(os.path.abspath(__file__))
CUPS_PPD_DIR = '/etc/cups/ppd'

STATIC_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.ppd':  'text/plain; charset=utf-8',
    '.svg':  'image/svg+xml',
    '.png':  'image/png',
}


def list_printers():
    """汇总 CUPS 打印机: 优先 lpstat, 并补充 /etc/cups/ppd 下的 PPD 文件。"""
    printers = {}

    # 1) lpstat -v  =>  "device for NAME: uri"
    try:
        out = subprocess.run(['lpstat', '-v'], capture_output=True, text=True, timeout=5).stdout
        for line in out.splitlines():
            m = re.match(r'device for (.+?):\s*(.*)', line.strip())
            if m:
                name, uri = m.group(1), m.group(2)
                printers.setdefault(name, {'name': name, 'device_uri': uri})
    except Exception:
        pass

    # 2) lpstat -l -p  =>  描述信息
    try:
        out = subprocess.run(['lpstat', '-l', '-p'], capture_output=True, text=True, timeout=5).stdout
        cur = None
        for line in out.splitlines():
            m = re.match(r'printer (\S+)', line.strip())
            if m:
                cur = m.group(1)
                printers.setdefault(cur, {'name': cur})
            elif cur and 'Description:' in line:
                printers[cur]['info'] = line.split('Description:', 1)[1].strip()
    except Exception:
        pass

    # 3) /etc/cups/ppd/*.ppd  =>  确认 PPD 是否就绪、可读
    for path in sorted(glob.glob(os.path.join(CUPS_PPD_DIR, '*.ppd'))):
        name = os.path.splitext(os.path.basename(path))[0]
        p = printers.setdefault(name, {'name': name})
        p['ppd_path'] = path
        p['ppd_readable'] = os.access(path, os.R_OK)

    result = []
    for name in sorted(printers):
        p = printers[name]
        p.setdefault('ppd_path', os.path.join(CUPS_PPD_DIR, name + '.ppd'))
        if 'ppd_readable' not in p:
            p['ppd_readable'] = os.access(p['ppd_path'], os.R_OK)
        result.append(p)
    return result


def read_ppd_text(path):
    """读取 PPD 文本。CUPS 的 PPD 多为 UTF-8, 容错读取。"""
    with open(path, 'rb') as f:
        raw = f.read()
    for enc in ('utf-8', 'latin-1'):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode('utf-8', 'replace')


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write('[ppdtest] ' + (fmt % args) + '\n')

    def _send(self, code, body, ctype='application/json; charset=utf-8'):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode('utf-8')
        elif isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def _serve_static(self, rel):
        if rel in ('', '/'):
            rel = 'index.html'
        rel = rel.lstrip('/')
        full = os.path.normpath(os.path.join(ROOT, rel))
        if not full.startswith(ROOT) or not os.path.isfile(full):
            return self._send(404, {'error': 'not found: %s' % rel})
        ctype = STATIC_TYPES.get(os.path.splitext(full)[1], 'application/octet-stream')
        with open(full, 'rb') as f:
            self._send(200, f.read(), ctype)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        if path == '/api/printers':
            try:
                return self._send(200, {'printers': list_printers()})
            except Exception as ex:
                return self._send(500, {'error': str(ex)})

        if path == '/api/ppd':
            target = None
            if 'name' in qs:
                target = os.path.join(CUPS_PPD_DIR, qs['name'][0] + '.ppd')
            elif 'path' in qs:
                target = qs['path'][0]
            if not target or not os.path.isfile(target):
                return self._send(404, {'error': '未找到 PPD: %s' % (target or '(空)')})
            if not os.access(target, os.R_OK):
                return self._send(403, {'error': 'PPD 不可读(可能需要权限): %s' % target})
            try:
                return self._send(200, {'path': target, 'text': read_ppd_text(target)})
            except Exception as ex:
                return self._send(500, {'error': str(ex)})

        if path == '/api/xlsx':                      # GET 形式: 按本地路径解析
            if xlsx_baseline is None:
                return self._send(500, {'error': '服务端缺少 openpyxl / xlsx_baseline 模块'})
            p = qs.get('path', [None])[0]
            if not p or not os.path.isfile(p):
                return self._send(404, {'error': '未找到 Excel: %s' % (p or '(空)')})
            try:
                return self._send(200, xlsx_baseline.parse_all(p))
            except Exception as ex:
                return self._send(500, {'error': '解析 Excel 失败: %s' % ex})

        return self._serve_static(path)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == '/api/xlsx':               # POST 形式: 上传 .xlsx 字节
            if xlsx_baseline is None:
                return self._send(500, {'error': '服务端缺少 openpyxl / xlsx_baseline 模块'})
            try:
                length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(length)
                return self._send(200, xlsx_baseline.parse_all(bytes(body)))
            except Exception as ex:
                return self._send(500, {'error': '解析 Excel 失败: %s' % ex})
        return self._send(404, {'error': 'not found'})


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4173
    srv = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    print('PPD 本地化测试工具已启动: http://127.0.0.1:%d/' % port)
    print('  打印机列表: GET /api/printers')
    print('  读取 PPD  : GET /api/ppd?name=<队列名>  或  /api/ppd?path=<文件路径>')
    print('按 Ctrl+C 退出。')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\n已退出。')


if __name__ == '__main__':
    main()
