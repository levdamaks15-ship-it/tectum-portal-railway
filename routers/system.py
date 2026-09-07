import os
import time
import subprocess
from datetime import datetime, timezone
from fastapi import APIRouter, Response

router = APIRouter(prefix="/api/system", tags=["system"])

# Server startup time in UTC
START_TIME = datetime.now(timezone.utc)
STARTUP_TIMESTAMP = int(time.time())

def _detect_version() -> str:
    """
    Detects current application version/commit hash.
    Priority:
    1. Railway Git Commit SHA (env RAILWAY_GIT_COMMIT_SHA)
    2. Railway Deployment ID (env RAILWAY_DEPLOYMENT_ID)
    3. Git repository commit hash (git rev-parse --short HEAD)
    4. Fallback to server startup timestamp
    """
    commit_sha = os.environ.get("RAILWAY_GIT_COMMIT_SHA")
    if commit_sha:
        return commit_sha.strip()[:8]
        
    deploy_id = os.environ.get("RAILWAY_DEPLOYMENT_ID")
    if deploy_id:
        return deploy_id.strip()[:8]
        
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            stderr=subprocess.DEVNULL,
            timeout=2
        )
        ver = out.decode("utf-8").strip()
        if ver:
            return ver
    except Exception:
        pass

    return f"ts_{STARTUP_TIMESTAMP}"

APP_VERSION = _detect_version()

@router.get("/version")
def get_system_version(response: Response):
    """
    Returns the current server deployment version and startup info.
    Includes strict Cache-Control headers to ensure clients never cache this check.
    """
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return {
        "version": APP_VERSION,
        "deployment_id": os.environ.get("RAILWAY_DEPLOYMENT_ID", ""),
        "started_at": START_TIME.isoformat(),
        "is_sandbox": os.environ.get("IS_SANDBOX", "false").lower() == "true"
    }

@router.get("/env")
def get_system_env(response: Response):
    """
    Legacy system environment flag.
    """
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return {
        "is_sandbox": os.environ.get("IS_SANDBOX", "false").lower() == "true"
    }

@router.get("/ping")
def ping_system(response: Response):
    """
    Ultra-lightweight ping healthcheck for client network latency and offline monitoring.
    """
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return {
        "status": "ok",
        "time": datetime.now(timezone.utc).isoformat()
    }

