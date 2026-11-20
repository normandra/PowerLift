"""FastAPI application entry point serving PairLift API and PWA frontend."""

import os
import socket
from contextlib import asynccontextmanager
from typing import Any, Dict, List

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from backend.db import init_db
from backend.routes import auth_routes, block_routes, log_routes

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")


def _detect_lan_ips() -> List[str]:
    ips = set()
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(0.1)
        sock.connect(("10.255.255.255", 1))
        ip = sock.getsockname()[0]
        sock.close()
        if ip and not ip.startswith("127."):
            ips.add(ip)
    except OSError:
        pass
    try:
        host_ips = socket.gethostbyname_ex(socket.gethostname())[2]
        for ip in host_ips:
            if ip and not ip.startswith("127."):
                ips.add(ip)
    except OSError:
        pass
    return sorted(ips)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="PairLift", version="1.0.0", lifespan=lifespan)

app.include_router(auth_routes.router)
app.include_router(block_routes.router)
app.include_router(log_routes.router)


@app.get("/api/health")
def health() -> Dict[str, Any]:
    return {"ok": True, "app": "PairLift"}


@app.get("/api/server-info")
def server_info(request: Request) -> Dict[str, Any]:
    port = request.url.port or 8000
    scheme = request.url.scheme or "http"
    lan_ips = _detect_lan_ips()
    lan_urls = [f"{scheme}://{ip}:{port}" for ip in lan_ips]
    return {
        "origin": str(request.base_url).rstrip("/"),
        "lan_ips": lan_ips,
        "lan_urls": lan_urls,
    }


@app.get("/manifest.webmanifest")
def manifest() -> FileResponse:
    return FileResponse(
        os.path.join(FRONTEND_DIR, "manifest.webmanifest"),
        media_type="application/manifest+json",
    )


@app.get("/sw.js")
def service_worker() -> Response:
    sw_path = os.path.join(FRONTEND_DIR, "sw.js")
    with open(sw_path, "r", encoding="utf-8") as f:
        content = f.read()
    return Response(
        content=content,
        media_type="application/javascript",
        headers={
            "Service-Worker-Allowed": "/",
            "Cache-Control": "no-cache, no-store, must-revalidate",
        },
    )


if os.path.isdir(os.path.join(FRONTEND_DIR, "css")):
    app.mount("/css", StaticFiles(directory=os.path.join(FRONTEND_DIR, "css")), name="css")
if os.path.isdir(os.path.join(FRONTEND_DIR, "js")):
    app.mount("/js", StaticFiles(directory=os.path.join(FRONTEND_DIR, "js")), name="js")
if os.path.isdir(os.path.join(FRONTEND_DIR, "icons")):
    app.mount("/icons", StaticFiles(directory=os.path.join(FRONTEND_DIR, "icons")), name="icons")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))
