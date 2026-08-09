"""Forgot-password / reset flow.

Two endpoints:
  POST /auth/password-reset/request  {email}         → always 202, generates
                                                       token and mails link
  POST /auth/password-reset/confirm  {token, new}    → sets a new password

We *always* return 202 on request so an attacker can't probe which emails
are registered.  If SMTP isn't configured, the reset URL is emitted to the
API log so operators can copy it during setup.
"""
from __future__ import annotations

import logging
import os
import secrets
import smtplib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import hash_password
from app.models.org import User
from app.models.password_reset import PasswordResetToken

router = APIRouter(prefix="/auth/password-reset", tags=["auth"])
log = logging.getLogger(__name__)

_TOKEN_TTL_MIN = int(os.getenv("PASSWORD_RESET_TTL_MINUTES", "60"))
_APP_URL = os.getenv("PUBLIC_APP_URL", "https://bharattax.wenvia.global")


class ResetRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)


class ResetConfirm(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    new_password: str = Field(min_length=8, max_length=200)


def _reset_email_html(recipient_name: str, reset_url: str, ttl_min: int) -> str:
    """Return the HTML body for the password-reset email.

    Kept intentionally simple: a single container, inline CSS, table-based
    layout so Gmail / Outlook render it reliably. No web fonts, no remote
    images -- both hurt spam scores badly on transactional mail.
    """
    safe_url = reset_url.replace('"', "%22")
    return f"""\
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Reset your BharatTax password</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    Set a new BharatTax password. This link is valid for the next {ttl_min} minutes.
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f6fb;padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
          <!-- header band -->
          <tr>
            <td style="background:linear-gradient(135deg,#0b1d36 0%,#13325b 55%,#1c4a85 100%);padding:26px 28px;color:#ffffff;">
              <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#c7d6ee;font-weight:600;">BharatTax Appeal Order</div>
              <div style="font-size:22px;font-weight:700;margin-top:6px;letter-spacing:-0.01em;">Password reset request</div>
            </td>
          </tr>
          <!-- body -->
          <tr>
            <td style="padding:28px 28px 8px 28px;">
              <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;color:#111827;">Hello {recipient_name},</p>
              <p style="margin:0 0 18px 0;font-size:14.5px;line-height:1.65;color:#374151;">
                We received a request to reset the password for your
                BharatTax account. Use the button below to choose a new one.
                For your security, this link will work for the next
                <strong>{ttl_min} minutes</strong> and can be used only once.
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 22px 0;">
                <tr>
                  <td align="center" bgcolor="#0b1d36" style="border-radius:10px;">
                    <a href="{safe_url}"
                       style="display:inline-block;padding:13px 26px;font-size:14.5px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;letter-spacing:0.01em;">
                      Set a new password
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 6px 0;font-size:12.5px;color:#6b7280;">If the button doesn't work, copy and paste this address into your browser:</p>
              <p style="margin:0 0 22px 0;font-size:12.5px;line-height:1.5;word-break:break-all;">
                <a href="{safe_url}" style="color:#1c4a85;text-decoration:underline;">{reset_url}</a>
              </p>
              <div style="border-top:1px solid #eef2f7;margin:6px 0 18px 0;"></div>
              <p style="margin:0 0 6px 0;font-size:12.5px;line-height:1.6;color:#6b7280;">
                Didn't ask for this? You can safely ignore the email — your
                password will not change unless you open the link above.
              </p>
              <p style="margin:0;font-size:12.5px;line-height:1.6;color:#6b7280;">
                For account safety, never share this link with anyone. BharatTax
                staff will never ask for it.
              </p>
            </td>
          </tr>
          <!-- footer -->
          <tr>
            <td style="padding:18px 28px 22px 28px;background:#f9fafb;border-top:1px solid #eef2f7;">
              <div style="font-size:12px;color:#6b7280;line-height:1.55;">
                Sent by <strong style="color:#111827;">BharatTax Appeal Order</strong>, the
                assisted CIT(A) / NFAC drafting workspace.<br>
                You received this email because someone requested a password
                reset for this address at
                <a href="{_APP_URL}" style="color:#1c4a85;text-decoration:none;">bharattax.wenvia.global</a>.
              </div>
            </td>
          </tr>
        </table>
        <div style="max-width:560px;margin:14px auto 0 auto;font-size:11px;color:#9ca3af;text-align:center;line-height:1.6;">
          This is an automated transactional message. Please do not reply.
        </div>
      </td>
    </tr>
  </table>
</body>
</html>"""


def _reset_email_text(recipient_name: str, reset_url: str, ttl_min: int) -> str:
    """Plain-text fallback -- Gmail penalises HTML-only mail heavily, so we
    always include a genuinely useful text/plain part with the same
    information as the HTML body."""
    return (
        f"Hello {recipient_name},\n\n"
        "We received a request to reset the password for your BharatTax\n"
        "account. Open the link below to choose a new one. For your\n"
        f"security, this link will work for the next {ttl_min} minutes and\n"
        "can be used only once.\n\n"
        f"    {reset_url}\n\n"
        "Didn't ask for this? You can safely ignore this email -- your\n"
        "password will not change unless you open the link above.\n\n"
        "For account safety, never share this link with anyone. BharatTax\n"
        "staff will never ask for it.\n\n"
        "--\n"
        "BharatTax Appeal Order\n"
        "Assisted CIT(A) / NFAC drafting workspace\n"
        f"{_APP_URL}\n"
    )


def _send_email(to: str, reset_url: str, recipient_name: str | None = None) -> None:
    """Best-effort email -- if SMTP env vars aren't set, log the URL so
    operators can copy/paste it while onboarding.

    We build a proper multipart/alternative message (plain + HTML) with real
    Date / Message-ID headers so Gmail's spam filter treats it as legit
    transactional mail rather than a scrap of text with a bare URL.
    """
    host = os.getenv("SMTP_HOST")
    if not host:
        log.warning("SMTP not configured -- password-reset link for %s: %s", to, reset_url)
        return
    port = int(os.getenv("SMTP_PORT", "587"))
    user = os.getenv("SMTP_USER")
    pw = os.getenv("SMTP_PASSWORD")
    sender = os.getenv("SMTP_FROM", user or "no-reply@bharattax.wenvia.global")

    # A friendly greeting name lowers "cold template" spam signal.
    name = (recipient_name or "").strip().split(" ")[0] if recipient_name else ""
    if not name:
        try:
            name = to.split("@", 1)[0].replace(".", " ").replace("_", " ").title()
        except Exception:  # noqa: BLE001
            name = "there"

    msg = EmailMessage()
    msg["Subject"] = "Reset your BharatTax password"
    msg["From"] = sender
    msg["To"] = to
    msg["Date"] = formatdate(localtime=True)
    # Use the sender's domain part so the Message-ID matches the From: header.
    sender_addr = sender
    if "<" in sender and ">" in sender:
        sender_addr = sender.split("<", 1)[1].rstrip(">")
    domain = sender_addr.split("@", 1)[-1] if "@" in sender_addr else "bharattax.wenvia.global"
    msg["Message-ID"] = make_msgid(domain=domain)
    # Marks the mail as auto-generated -- Gmail treats these more gently and
    # they never generate auto-replies / vacation responders.
    msg["Auto-Submitted"] = "auto-generated"
    msg["X-Auto-Response-Suppress"] = "All"
    msg["Precedence"] = "bulk"
    msg["MIME-Version"] = "1.0"
    msg["X-Mailer"] = "BharatTax/Notify"
    # A visible Reply-To on a real, monitored address helps Gmail decide the
    # sender is legitimate -- and gives users somewhere to write back to.
    reply_to = os.getenv("SMTP_REPLY_TO", "support@bharattax.wenvia.global")
    msg["Reply-To"] = reply_to
    # RFC 8058: Gmail specifically rewards transactional mail that offers a
    # one-click unsubscribe path, even for password-reset mail. It also makes
    # bulk-mail filters more forgiving.
    unsubscribe = f"{_APP_URL.rstrip('/')}/email-unsubscribe?addr={to}"
    msg["List-Unsubscribe"] = f"<{unsubscribe}>, <mailto:{reply_to}?subject=unsubscribe>"
    msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"

    text_body = _reset_email_text(name, reset_url, _TOKEN_TTL_MIN)
    html_body = _reset_email_html(name, reset_url, _TOKEN_TTL_MIN)
    msg.set_content(text_body)
    msg.add_alternative(html_body, subtype="html")

    try:
        with smtplib.SMTP(host, port, timeout=15) as s:
            s.ehlo()
            if os.getenv("SMTP_STARTTLS", "1") in ("1", "true", "True"):
                s.starttls(); s.ehlo()
            if user and pw:
                s.login(user, pw)
            s.send_message(msg)
    except Exception as exc:  # noqa: BLE001
        log.warning("SMTP send failed for %s: %s (link: %s)", to, exc, reset_url)


@router.post("/request", status_code=202)
def request_reset(body: ResetRequest, request: Request,
                  db: Session = Depends(get_db)) -> dict:
    # Throttle: an unauthenticated endpoint that sends an email + writes a token
    # per call — cap it so it can't be used to email-bomb a registered address.
    from app.core import ratelimit
    ratelimit.enforce(request, "pwreset_request", max_hits=5, window_s=600)
    email = str(body.email).strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    if user is not None:
        # Invalidate any previous unused tokens for tidiness.
        prev = db.scalars(
            select(PasswordResetToken).where(
                PasswordResetToken.user_id == user.id,
                PasswordResetToken.consumed_at.is_(None),
            )
        ).all()
        for p in prev:
            p.consumed_at = datetime.now(timezone.utc)

        tok = secrets.token_urlsafe(32)
        pr = PasswordResetToken(
            user_id=user.id,
            token=tok,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=_TOKEN_TTL_MIN),
            ip_address=(request.client.host if request.client else None),
        )
        db.add(pr); db.commit()
        reset_url = f"{_APP_URL.rstrip('/')}/reset-password?token={tok}"
        _send_email(email, reset_url, recipient_name=user.full_name or user.username)
    # Constant reply regardless of whether the email exists.
    return {"ok": True,
            "message": "If that email is registered, a reset link has been sent."}


@router.post("/confirm")
def confirm_reset(body: ResetConfirm, request: Request,
                  db: Session = Depends(get_db)) -> dict:
    from app.core import ratelimit
    ratelimit.enforce(request, "pwreset_confirm", max_hits=10, window_s=600)
    pr = db.scalar(select(PasswordResetToken).where(
        PasswordResetToken.token == body.token
    ))
    if pr is None or pr.consumed_at is not None:
        raise HTTPException(400, "This reset link has already been used or is invalid.")
    if pr.expires_at < datetime.now(timezone.utc):
        raise HTTPException(400, "This reset link has expired. Please request a new one.")
    user = db.get(User, pr.user_id)
    if user is None:
        raise HTTPException(400, "Account no longer exists.")
    user.password_hash = hash_password(body.new_password)
    pr.consumed_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True, "email": user.email, "username": user.username}
