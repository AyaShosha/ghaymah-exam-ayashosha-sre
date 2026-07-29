import json
import os
import socket
import ssl
import threading
import time
from datetime import datetime
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.error import HTTPError
from urllib.request import urlopen

URL = "https://mithal.space"
SEARCH_URL = "https://mithal.space/search?q=test"
HOST = "mithal.space"
METRICS_FILE = "metrics.json"


def check_http(url):
    start = time.time()
    status = 0
    ok = False
    try:
        res = urlopen(url, timeout=15)
        status = res.status
        ok = status == 200
        res.read(1024)
    except HTTPError as e:
        status = e.code
        ok = status == 200
    except Exception:
        ok = False
    ms = round((time.time() - start) * 1000, 2)
    return ms, status, ok


def check_dns():
    start = time.time()
    ok = False
    try:
        socket.gethostbyname(HOST)
        ok = True
    except Exception:
        ok = False
    ms = round((time.time() - start) * 1000, 2)
    return ms, ok


def check_ssl():
    valid = False
    expires = None
    days_left = None
    try:
        ctx = ssl.create_default_context()
        with socket.create_connection((HOST, 443), timeout=10) as s:
            with ctx.wrap_socket(s, server_hostname=HOST) as ss:
                cert = ss.getpeercert()
        expires = cert["notAfter"]
        exp_date = datetime.strptime(expires, "%b %d %H:%M:%S %Y %GMT")
        days_left = (exp_date - datetime.utcnow()).days
        valid = True
    except Exception:
        pass
    return valid, expires, days_left


def run_check():
    latency, status_code, uptime = check_http(URL)
    dns_ms, dns_ok = check_dns()
    ssl_ok, ssl_expires, ssl_days = check_ssl()
    search_ms, search_code, search_ok = check_http(SEARCH_URL)

    row = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "latency_ms": latency,
        "uptime": uptime,
        "status_code": status_code,
        "dns_ms": dns_ms,
        "ssl_valid": ssl_ok,
        "ssl_expires": ssl_expires,
        "ssl_days_remaining": ssl_days,
        "search_ms": search_ms,
        "search_status_code": search_code,
        "overall": uptime and dns_ok and ssl_ok and search_ok,
    }
    return row


def save_row(row):
    data = []
    if os.path.exists(METRICS_FILE):
        with open(METRICS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)

    data.append(row)

    # keep last 24 hours (1440 checks if every 1 min)
    if len(data) > 1440:
        data = data[-1440:]

    with open(METRICS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def monitor_loop():
    while True:
        row = run_check()
        save_row(row)
        print(row)
        time.sleep(60)


def start_server():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = HTTPServer(("0.0.0.0", 5000), SimpleHTTPRequestHandler)
    print("dashboard: http://0.0.0.0:5000/dashboard.html")
    server.serve_forever()


if __name__ == "__main__":
    save_row(run_check())
    threading.Thread(target=monitor_loop, daemon=True).start()
    start_server()
