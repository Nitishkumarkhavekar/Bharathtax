"""Admin CRUD for the desktop-app release catalogue.

Two responsibilities:
 1. Store metadata (version, notes, channel, current flag) in Postgres.
 2. Upload the .exe artefacts to R2 and (re)write the `release/latest.yml`
    manifest that electron-updater on the officer's laptop reads.

The public update feed (`/desktop/update/*`) still serves out of R2 exactly
as before — this route just gives an admin a UI to publish new releases.
"""
from __future__ import annotations

import base64
import hashlib
import io
import logging
import re

import yaml
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import desc, select, update
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.db import get_db
from app.models.desktop import DesktopRelease
from app.models.enums import Role
from app.models.org import User
from app.services import storage

router = APIRouter(prefix="/admin/desktop-releases", tags=["admin", "desktop-releases"])
log = logging.getLogger(__name__)

_VERSION_RE = re.compile(r"^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$")


# ---------------------------------------------------------------------- auth
def _admin(user: User = Depends(get_current_user)) -> User:
    if user.role not in (Role.super_admin, Role.wing_admin):
        raise HTTPException(403, "Admin access required")
    return user


# ---------------------------------------------------------------- serializer
def _out(r: DesktopRelease) -> dict:
    return {
        "id": r.id,
        "version": r.version,
        "channel": r.channel,
        "notes": r.notes,
        "installer_key": r.installer_key,
        "portable_key": r.portable_key,
        "blockmap_key": r.blockmap_key,
        "installer_size": r.installer_size,
        "portable_size": r.portable_size,
        "installer_sha512": r.installer_sha512,
        "is_current": bool(r.is_current),
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


# ---------------------------------------------------------------- yml writer
def _write_latest_yml(r: DesktopRelease) -> None:
    """Publish an electron-updater manifest to `release/latest.yml`.

    Format matches the one electron-builder produces natively so an installed
    v1.0.0 client speaking to us reads exactly what it expects.
    """
    if not (r.installer_key and r.installer_size and r.installer_sha512):
        raise HTTPException(400, "installer_key / size / sha512 all required to publish")
    # electron-updater expects `sha512` base64-encoded.
    sha_b64 = base64.b64encode(bytes.fromhex(r.installer_sha512)).decode()
    installer_filename = r.installer_key.rsplit("/", 1)[-1]
    manifest = {
        "version": r.version,
        "files": [{
            "url": installer_filename,
            "sha512": sha_b64,
            "size": int(r.installer_size),
        }],
        "path": installer_filename,
        "sha512": sha_b64,
        "releaseDate": (r.updated_at or r.created_at).isoformat() if r.updated_at or r.created_at else None,
    }
    if r.notes:
        manifest["releaseNotes"] = r.notes
    body = yaml.safe_dump(manifest, sort_keys=False).encode()
    storage.put_bytes("release/latest.yml", body, content_type="application/x-yaml")


# ---------------------------------------------------------------- list
@router.get("")
def list_releases(admin: User = Depends(_admin),
                  db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(DesktopRelease).order_by(desc(DesktopRelease.id))).all()
    return [_out(r) for r in rows]


# ---------------------------------------------------------------- upload
@router.post("")
async def create_release(
    version: str = Form(...),
    channel: str = Form("latest"),
    notes: str | None = Form(None),
    publish: bool = Form(True),
    installer: UploadFile = File(...),
    portable: UploadFile | None = File(None),
    blockmap: UploadFile | None = File(None),
    admin: User = Depends(_admin),
    db: Session = Depends(get_db),
) -> dict:
    """Upload a new release.

    Steps:
      1. Validate the version and file uploads.
      2. Stream the installer + portable + blockmap to R2 under
         `release/BharatTax-Appeal-Order-{Setup|Portable}-{version}.exe[.blockmap]`.
      3. Compute SHA-512 of the installer for electron-updater verification.
      4. Persist the row.  If `publish=True`, mark it current and write
         `release/latest.yml`.
    """
    version = version.strip()
    channel = (channel or "latest").strip() or "latest"
    if not _VERSION_RE.match(version):
        raise HTTPException(400, "version must look like 1.0.0 or 1.0.0-beta.1")
    if db.scalar(select(DesktopRelease).where(DesktopRelease.version == version)):
        raise HTTPException(409, f"Version {version} already exists")

    # Read installer once so we can both hash and stream to R2.
    installer_bytes = await installer.read()
    if not installer_bytes:
        raise HTTPException(400, "installer file is empty")
    installer_sha = hashlib.sha512(installer_bytes).hexdigest()
    installer_size = len(installer_bytes)
    installer_key = f"release/BharatTax-Appeal-Order-Setup-{version}.exe"
    storage.put_bytes(installer_key, installer_bytes,
                      content_type="application/vnd.microsoft.portable-executable")

    portable_key = None
    portable_size = None
    if portable is not None:
        portable_bytes = await portable.read()
        if portable_bytes:
            portable_size = len(portable_bytes)
            portable_key = f"release/BharatTax-Appeal-Order-Portable-{version}.exe"
            storage.put_bytes(portable_key, portable_bytes,
                              content_type="application/vnd.microsoft.portable-executable")

    blockmap_key = None
    if blockmap is not None:
        blockmap_bytes = await blockmap.read()
        if blockmap_bytes:
            blockmap_key = installer_key + ".blockmap"
            storage.put_bytes(blockmap_key, blockmap_bytes,
                              content_type="application/octet-stream")

    row = DesktopRelease(
        version=version, channel=channel, notes=(notes or None),
        installer_key=installer_key, portable_key=portable_key,
        blockmap_key=blockmap_key,
        installer_size=installer_size, portable_size=portable_size,
        installer_sha512=installer_sha,
        is_current=False, uploaded_by_user_id=admin.id,
    )
    db.add(row); db.flush()

    if publish:
        # Demote every other release on the same channel.
        db.execute(
            update(DesktopRelease)
            .where(DesktopRelease.channel == channel, DesktopRelease.is_current == True)  # noqa: E712
            .values(is_current=False)
        )
        row.is_current = True

    db.commit(); db.refresh(row)

    if publish:
        _write_latest_yml(row)

    return _out(row)


# ---------------------------------------------------------------- edit
class ReleasePatch(BaseModel):
    notes: str | None = None
    channel: str | None = None


@router.patch("/{release_id}")
def patch_release(release_id: int, body: ReleasePatch,
                  admin: User = Depends(_admin),
                  db: Session = Depends(get_db)) -> dict:
    r = db.get(DesktopRelease, release_id)
    if not r:
        raise HTTPException(404, "Release not found")
    if body.notes is not None:
        r.notes = body.notes.strip() or None
    if body.channel is not None:
        r.channel = body.channel.strip() or "latest"
    db.commit(); db.refresh(r)
    if r.is_current:
        _write_latest_yml(r)
    return _out(r)


# ---------------------------------------------------------------- publish
@router.post("/{release_id}/publish")
def publish_release(release_id: int,
                    admin: User = Depends(_admin),
                    db: Session = Depends(get_db)) -> dict:
    """Mark this release as current on its channel and rewrite latest.yml."""
    r = db.get(DesktopRelease, release_id)
    if not r:
        raise HTTPException(404, "Release not found")
    db.execute(
        update(DesktopRelease)
        .where(DesktopRelease.channel == r.channel, DesktopRelease.is_current == True)  # noqa: E712
        .values(is_current=False)
    )
    r.is_current = True
    db.commit(); db.refresh(r)
    _write_latest_yml(r)
    return _out(r)


# ---------------------------------------------------------------- delete
@router.delete("/{release_id}", status_code=204)
def delete_release(release_id: int,
                   admin: User = Depends(_admin),
                   db: Session = Depends(get_db)) -> Response:
    r = db.get(DesktopRelease, release_id)
    if not r:
        return Response(status_code=204)
    if r.is_current:
        raise HTTPException(409, "Cannot delete the current release. Publish another one first.")
    for key in (r.installer_key, r.portable_key, r.blockmap_key):
        if not key:
            continue
        try:
            storage.remove_object(key)
        except Exception as e:  # noqa: BLE001
            log.warning("R2 delete failed for %s: %s", key, e)
    db.delete(r); db.commit()
    return Response(status_code=204)
