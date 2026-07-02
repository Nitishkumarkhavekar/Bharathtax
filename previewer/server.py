"""Tiny HTTP server: POST a .docx body, get the rendered .pdf back.

LibreOffice headless does the actual conversion. A single conversion runs at
a time per worker (LibreOffice can't safely share a user profile across
concurrent runs); the previewer service is single-worker for this reason.
"""
from __future__ import annotations

import io
import os
import shutil
import subprocess
import tempfile
import time
import uuid

from flask import Flask, request, send_file

app = Flask(__name__)


@app.get("/health")
def health() -> tuple[str, int]:
    return "ok", 200


@app.post("/convert")
def convert() -> object:
    data = request.get_data() or b""
    if not data:
        return ("Empty request body", 400)

    work = tempfile.mkdtemp(prefix="conv-")
    try:
        src = os.path.join(work, f"in-{uuid.uuid4().hex}.docx")
        with open(src, "wb") as f:
            f.write(data)

        t0 = time.time()
        # `-env:UserInstallation` gives this conversion its own profile dir so
        # concurrent runs (if a future worker count > 1) don't clobber each
        # other's settings.
        profile = f"file://{work}/profile"
        cmd = [
            "soffice",
            f"-env:UserInstallation={profile}",
            "--headless",
            "--norestore",
            "--nologo",
            "--nofirststartwizard",
            "--convert-to",
            "pdf",
            "--outdir",
            work,
            src,
        ]
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=90,
        )
        if proc.returncode != 0:
            return (
                f"soffice failed (rc={proc.returncode}):\n{proc.stdout}\n{proc.stderr}",
                500,
            )

        pdf = os.path.join(work, os.path.splitext(os.path.basename(src))[0] + ".pdf")
        if not os.path.exists(pdf):
            return ("No PDF produced", 500)

        with open(pdf, "rb") as f:
            body = f.read()
        elapsed_ms = int((time.time() - t0) * 1000)
        app.logger.info("converted %d bytes -> %d bytes in %d ms", len(data), len(body), elapsed_ms)
        return send_file(
            io.BytesIO(body),
            mimetype="application/pdf",
            as_attachment=False,
            download_name="preview.pdf",
        )
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5151)
