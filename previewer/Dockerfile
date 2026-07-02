# Headless LibreOffice that converts .docx -> .pdf over HTTP.
# Used by the BharathTax appeal page to render Module 6 as a proper Word-style
# preview instead of raw markdown.
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        libreoffice-core \
        libreoffice-writer \
        fonts-liberation \
        fonts-dejavu \
        fonts-noto-core \
        python3 \
        python3-flask \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Pre-warm LibreOffice's first-run profile so the first real request doesn't
# take 10+ seconds.
RUN soffice --headless --norestore --nologo --nofirststartwizard \
        --convert-to pdf --outdir /tmp \
        /usr/share/libreoffice/share/template/common/wizard/mailmerge/2pages.ott \
        2>&1 | head -3 || true

WORKDIR /app
COPY server.py /app/server.py

EXPOSE 5151

# Flask's built-in server is enough — this is an internal sidecar that handles
# one conversion at a time (LibreOffice can't safely share a profile across
# concurrent runs anyway).
ENV FLASK_APP=server:app
CMD ["python3", "-u", "/app/server.py"]
