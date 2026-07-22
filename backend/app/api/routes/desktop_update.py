"""Auto-update feed for the BharatTax desktop app.

`electron-updater` (packaged inside the .exe) polls this feed on launch:
    GET /desktop/update/latest.yml   -> update manifest
    GET /desktop/update/<file>       -> the actual .exe / .blockmap

The manifest and the installer both live under `release/` in the same R2
bucket the web app already uses.  We keep the desktop app pointing at the
bharattax API host (which is stable) and use the API to hand out short-lived
presigned R2 URLs (or stream the bytes for the tiny `.yml` manifest, so the
first-hop check is instant).  This way we never expose the raw R2 endpoint
to end-users, and rotating R2 credentials never breaks an installed .exe.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models.desktop import DesktopRelease
from app.services import storage

router = APIRouter(prefix="/desktop/update", tags=["desktop-update"])
# Second, public-facing router at /desktop/releases for the landing-page
# downloads section.  Keeping it in the same file so the download filename
# construction stays consistent with the update-feed.
public_router = APIRouter(prefix="/desktop", tags=["desktop-releases"])
log = logging.getLogger(__name__)


def _release_out(r: DesktopRelease) -> dict:
    installer_name = r.installer_key.rsplit("/", 1)[-1] if r.installer_key else None
    portable_name = r.portable_key.rsplit("/", 1)[-1] if r.portable_key else None
    return {
        "version": r.version,
        "channel": r.channel,
        "notes": r.notes,
        "is_current": bool(r.is_current),
        "installer_size": r.installer_size,
        "portable_size": r.portable_size,
        "installer_download_url": f"/desktop/update/{installer_name}" if installer_name else None,
        "portable_download_url": f"/desktop/update/{portable_name}" if portable_name else None,
        "installer_filename": installer_name,
        "portable_filename": portable_name,
        "released_at": (r.updated_at or r.created_at).isoformat()
                       if (r.updated_at or r.created_at) else None,
    }


@public_router.get("/releases")
def public_releases(db: Session = Depends(get_db)) -> dict:
    """Publicly-listable release catalogue for the landing-page download
    section.  Returns the current release plus every prior one so users can
    grab an older version if they need to.

    No auth: the .exe artefacts are already public via presigned redirects
    on the /desktop/update/{file} endpoint.
    """
    rows = db.scalars(
        select(DesktopRelease)
        .where(DesktopRelease.channel == "latest")
        .order_by(desc(DesktopRelease.created_at))
    ).all()
    releases = [_release_out(r) for r in rows if r.installer_key]
    current = next((r for r in releases if r["is_current"]), None)
    return {
        "current": current,
        "releases": releases,
    }

_MANIFEST_KEYS = ("latest.yml", "latest-mac.yml", "latest-linux.yml")
_ALLOWED_SUFFIXES = (".exe", ".exe.blockmap", ".zip", ".yml")


@router.get("/latest.yml")
def latest_manifest() -> Response:
    """Return the update manifest.

    electron-updater expects a small YAML with `version`, `path` (relative
    filename), and a `sha512`.  We stream the bytes back directly so the
    updater doesn't have to follow a redirect for every launch — the file
    is only a few hundred bytes.
    """
    key = "release/latest.yml"
    try:
        data = storage.get_bytes(key)
    except Exception as e:  # noqa: BLE001
        log.warning("latest.yml fetch failed: %s", e)
        raise HTTPException(404, "No update manifest published yet")
    return Response(
        content=data,
        media_type="application/x-yaml",
        headers={"Cache-Control": "no-cache, must-revalidate"},
    )


@router.get("/{filename:path}")
def update_asset(filename: str) -> RedirectResponse:
    """Redirect to a fresh presigned R2 URL for the requested asset.

    We refuse anything that isn't clearly a release artefact (whitelist by
    suffix) and refuse path traversal, so this endpoint cannot be abused to
    enumerate arbitrary bucket keys.
    """
    if ".." in filename or filename.startswith("/") or "\\" in filename:
        raise HTTPException(400, "Invalid update asset path")
    if filename in _MANIFEST_KEYS:
        # Manifests are streamed via /latest.yml so `electron-updater` gets
        # them without a redirect. Forward manifest sub-paths to that route.
        return RedirectResponse(url="/desktop/update/latest.yml", status_code=302)
    if not filename.lower().endswith(_ALLOWED_SUFFIXES):
        raise HTTPException(400, "Unsupported update asset type")

    key = f"release/{filename}"
    try:
        url = storage.presigned_get_url(key, expires_seconds=15 * 60)
    except Exception as e:  # noqa: BLE001
        log.warning("presign for %s failed: %s", key, e)
        raise HTTPException(404, "Update asset not found")
    # 302 so the electron-updater HTTP client follows the redirect. Cache
    # header on the redirect keeps the presigned URL fresh per request.
    return RedirectResponse(url=url, status_code=302, headers={
        "Cache-Control": "no-cache, must-revalidate",
    })
