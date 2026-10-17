import logging
import smtplib
import socket
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

import httpx

from . import config

logger = logging.getLogger(__name__)


class EmailDeliveryError(Exception):
    """Raised when email delivery fails via the configured provider or SMTP server."""
    pass


class IPv4SMTP(smtplib.SMTP):
    """SMTP client that explicitly connects over IPv4 to avoid IPv6 unreachable errors on dual-stack hosts."""
    def _get_socket(self, host, port, timeout):
        addr_info = socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM)
        last_err = None
        for af, socktype, proto, canonname, sa in addr_info:
            sock = None
            try:
                sock = socket.socket(af, socktype, proto)
                sock.settimeout(timeout)
                sock.connect(sa)
                return sock
            except Exception as err:
                last_err = err
                if sock is not None:
                    sock.close()
        raise last_err or OSError(f"Could not connect to {host}:{port}")


class IPv4SMTP_SSL(smtplib.SMTP_SSL):
    """SMTP_SSL client that explicitly connects over IPv4."""
    def _get_socket(self, host, port, timeout):
        addr_info = socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM)
        last_err = None
        for af, socktype, proto, canonname, sa in addr_info:
            sock = None
            try:
                sock = socket.socket(af, socktype, proto)
                sock.settimeout(timeout)
                sock.connect(sa)
                new_sock = self.context.wrap_socket(sock, server_hostname=self._host)
                return new_sock
            except Exception as err:
                last_err = err
                if sock is not None:
                    sock.close()
        raise last_err or OSError(f"Could not connect to {host}:{port}")


def _send_via_resend(
    to_email: str,
    otp: str,
    purpose: str,
    email_subject: str,
    text_content: str,
    html_content: str,
) -> bool:
    """Dispatches verification email via Resend HTTPS API (Port 443)."""
    api_key = (config.RESEND_API_KEY or "").strip()
    if not api_key:
        logger.error("Email: RESEND_API_KEY is not configured. Outbound verification emails cannot be delivered via HTTPS.")
        raise EmailDeliveryError("Email delivery service is not configured. Please set RESEND_API_KEY in Render environment variables.")

    from_email = config.RESEND_FROM_EMAIL or "DocMe <onboarding@resend.dev>"
    logger.info("Email: Dispatching OTP email to %s via Resend HTTPS API (from: %s)...", to_email, from_email)

    url = "https://api.resend.com/emails"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "from": from_email,
        "to": [to_email],
        "subject": email_subject,
        "text": text_content,
        "html": html_content,
    }

    try:
        with httpx.Client(timeout=httpx.Timeout(15.0, connect=5.0)) as client:
            resp = client.post(url, json=payload, headers=headers)
    except httpx.TimeoutException as exc:
        logger.error("Email: Resend HTTPS request timed out")
        raise EmailDeliveryError("Email delivery service timed out. Please try again.") from exc
    except httpx.RequestError as exc:
        logger.error("Email: Resend HTTPS network error (%s: %s)", type(exc).__name__, exc)
        raise EmailDeliveryError(f"Email delivery network error: {type(exc).__name__}") from exc
    except Exception as exc:
        logger.error("Email: Resend request failed (%s)", type(exc).__name__)
        raise EmailDeliveryError(f"Email delivery failed: {type(exc).__name__}") from exc

    if resp.status_code in (200, 201):
        data = resp.json()
        logger.info("Email: Successfully delivered OTP email to %s via Resend (ID: %s)", to_email, data.get("id"))
        return True

    # Parse and sanitize provider error response
    try:
        err_json = resp.json()
        raw_msg = err_json.get("message") or resp.text
    except Exception:
        raw_msg = resp.text

    sanitized_msg = str(raw_msg)
    if api_key and api_key in sanitized_msg:
        sanitized_msg = sanitized_msg.replace(api_key, "[REDACTED]")
    if otp and otp in sanitized_msg:
        sanitized_msg = sanitized_msg.replace(otp, "[REDACTED]")

    logger.error("Email: Resend API rejected delivery (HTTP %s): %s", resp.status_code, sanitized_msg)
    raise EmailDeliveryError(f"Resend delivery error (HTTP {resp.status_code}): {sanitized_msg}")


def _send_via_brevo(
    to_email: str,
    otp: str,
    purpose: str,
    email_subject: str,
    text_content: str,
    html_content: str,
) -> bool:
    """Dispatches verification email via Brevo HTTPS API (Port 443)."""
    api_key = (config.BREVO_API_KEY or "").strip()
    from_email = config.BREVO_FROM_EMAIL or config.SMTP_FROM_EMAIL or "noreply@docme.app"
    logger.info("Email: Dispatching OTP email to %s via Brevo HTTPS API...", to_email)

    url = "https://api.brevo.com/v3/smtp/email"
    headers = {
        "api-key": api_key,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    payload = {
        "sender": {"name": "DocMe", "email": from_email},
        "to": [{"email": to_email}],
        "subject": email_subject,
        "htmlContent": html_content,
        "textContent": text_content,
    }

    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.post(url, json=payload, headers=headers)
    except Exception as exc:
        logger.error("Email: Brevo HTTPS request failed (%s: %s)", type(exc).__name__, exc)
        raise EmailDeliveryError(f"Brevo HTTPS request failed: {type(exc).__name__}") from exc

    if resp.status_code in (200, 201, 202):
        data = resp.json()
        logger.info("Email: Successfully delivered OTP email to %s via Brevo (ID: %s)", to_email, data.get("messageId"))
        return True

    err_text = resp.text
    logger.error("Email: Brevo rejected delivery (HTTP %s): %s", resp.status_code, err_text)
    raise EmailDeliveryError(f"Brevo delivery error (HTTP {resp.status_code}): {err_text}")


def _send_via_sendgrid(
    to_email: str,
    otp: str,
    purpose: str,
    email_subject: str,
    text_content: str,
    html_content: str,
) -> bool:
    """Dispatches verification email via SendGrid HTTPS API (Port 443)."""
    api_key = (config.SENDGRID_API_KEY or "").strip()
    from_email = config.SENDGRID_FROM_EMAIL or config.SMTP_FROM_EMAIL or "noreply@docme.app"
    logger.info("Email: Dispatching OTP email to %s via SendGrid HTTPS API...", to_email)

    url = "https://api.sendgrid.com/v3/mail/send"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "personalizations": [{"to": [{"email": to_email}]}],
        "from": {"email": from_email, "name": "DocMe"},
        "subject": email_subject,
        "content": [
            {"type": "text/plain", "value": text_content},
            {"type": "text/html", "value": html_content},
        ],
    }

    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.post(url, json=payload, headers=headers)
    except Exception as exc:
        logger.error("Email: SendGrid HTTPS request failed (%s: %s)", type(exc).__name__, exc)
        raise EmailDeliveryError(f"SendGrid HTTPS request failed: {type(exc).__name__}") from exc

    if resp.status_code in (200, 202):
        logger.info("Email: Successfully delivered OTP email to %s via SendGrid", to_email)
        return True

    err_text = resp.text
    logger.error("Email: SendGrid rejected delivery (HTTP %s): %s", resp.status_code, err_text)
    raise EmailDeliveryError(f"SendGrid delivery error (HTTP {resp.status_code}): {err_text}")


def _send_via_smtp(
    to_email: str,
    otp: str,
    purpose: str,
    email_subject: str,
    text_content: str,
    html_content: str,
) -> bool:
    """Dispatches verification email via direct SMTP with granular diagnostics."""
    smtp_host = (config.SMTP_HOST or "").strip()
    smtp_port = config.SMTP_PORT or (465 if config.SMTP_USE_SSL else 587)
    smtp_user = config.SMTP_USER
    smtp_password = config.SMTP_PASSWORD
    smtp_from_email = config.SMTP_FROM_EMAIL or smtp_user or "noreply@docme.app"
    smtp_use_ssl = config.SMTP_USE_SSL
    smtp_use_tls = config.SMTP_USE_TLS
    smtp_timeout = config.SMTP_TIMEOUT_SECONDS or 10

    # Step 1: DNS Resolution diagnostic
    logger.info("SMTP: Resolving '%s' via IPv4...", smtp_host)
    try:
        addr_info = socket.getaddrinfo(smtp_host, smtp_port, socket.AF_INET, socket.SOCK_STREAM)
        ipv4_addrs = list({res[4][0] for res in addr_info})
        logger.info("SMTP: Resolved '%s' to IPv4 address(es): %s", smtp_host, ipv4_addrs)
    except Exception as dns_err:
        logger.error("SMTP DNS resolution FAILED for '%s': %s", smtp_host, dns_err)
        raise EmailDeliveryError(f"SMTP DNS resolution failed for {smtp_host}: {dns_err}") from dns_err

    msg = MIMEMultipart("alternative")
    msg["Subject"] = email_subject
    msg["From"] = smtp_from_email
    msg["To"] = to_email
    msg.attach(MIMEText(text_content, "plain", "utf-8"))
    msg.attach(MIMEText(html_content, "html", "utf-8"))

    logger.info(
        "SMTP: Connecting to %s:%s (SSL=%s, TLS=%s, timeout=%ss)...",
        smtp_host, smtp_port, smtp_use_ssl, smtp_use_tls, smtp_timeout
    )

    server = None
    try:
        # Step 2: TCP Connection
        if smtp_use_ssl:
            server = IPv4SMTP_SSL(smtp_host, smtp_port, timeout=smtp_timeout)
        else:
            server = IPv4SMTP(smtp_host, smtp_port, timeout=smtp_timeout)
        logger.info("SMTP: TCP connection established to %s:%s", smtp_host, smtp_port)

        # Step 3: TLS Negotiation
        if smtp_use_tls and not smtp_use_ssl:
            logger.info("SMTP: Initiating STARTTLS with %s:%s...", smtp_host, smtp_port)
            server.starttls()
            logger.info("SMTP: TLS negotiation successful.")

        # Step 4: Authentication
        if smtp_user and smtp_password:
            logger.info("SMTP: Authenticating user '%s'...", smtp_user)
            server.login(smtp_user, smtp_password)
            logger.info("SMTP: Authentication successful.")

        # Step 5: Dispatch message
        logger.info("SMTP: Dispatching email to %s...", to_email)
        server.send_message(msg)
        logger.info("SMTP: Successfully dispatched verification email to %s", to_email)
        return True

    except (socket.error, OSError) as net_err:
        logger.error(
            "SMTP network connection FAILED to %s:%s (%s: %s). "
            "Note: Render blocks outbound SMTP ports 25, 465, and 587 on standard tiers. "
            "To send emails on Render, configure an HTTPS provider such as Resend (RESEND_API_KEY).",
            smtp_host, smtp_port, type(net_err).__name__, net_err
        )
        raise EmailDeliveryError(f"SMTP connection unreachable: {net_err}") from net_err
    except smtplib.SMTPAuthenticationError as auth_err:
        logger.error("SMTP Authentication FAILED for '%s': %s", smtp_user, auth_err)
        raise EmailDeliveryError("SMTP authentication failed. Please check your credentials.") from auth_err
    except Exception as exc:
        err_msg = str(exc)
        if smtp_password and smtp_password in err_msg:
            err_msg = err_msg.replace(smtp_password, "[REDACTED]")
        if otp and otp in err_msg:
            err_msg = err_msg.replace(otp, "[REDACTED]")
        logger.error("SMTP delivery FAILED to %s: %s - %s", to_email, type(exc).__name__, err_msg)
        raise EmailDeliveryError(f"Failed to deliver verification email: {type(exc).__name__}") from exc
    finally:
        if server:
            try:
                server.quit()
            except Exception:
                pass


def send_otp_email(
    to_email: str,
    otp: str,
    purpose: str = "registration",
    subject: Optional[str] = None,
) -> bool:
    """
    Delivers a verification OTP email via configured email service.
    Supports:
    1. Resend HTTPS API (RESEND_API_KEY) - recommended for cloud hosts like Render
    2. Brevo HTTPS API (BREVO_API_KEY)
    3. SendGrid HTTPS API (SENDGRID_API_KEY)
    4. Direct SMTP over IPv4 (SMTP_HOST, SMTP_PORT, etc.) with granular diagnostic logging
    Never logs passwords or plaintext OTPs.
    """
    clean_email = to_email.strip()
    clean_purpose = purpose.replace("_", " ").title()
    email_subject = subject or f"DocMe — Your {clean_purpose} Verification Code"

    # Plain text version
    text_content = (
        f"Hello,\n\n"
        f"Your DocMe verification code for {purpose.replace('_', ' ')} is: {otp}\n\n"
        f"This code will expire in {config.OTP_VALIDITY_SECONDS} seconds.\n"
        f"If you did not request this code, please ignore this email.\n\n"
        f"— The DocMe Team"
    )

    # HTML formatted version
    html_content = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; color: #f8fafc; margin: 0; padding: 24px; }}
    .container {{ max-width: 500px; margin: 0 auto; background: #1e293b; border-radius: 12px; padding: 32px; border: 1px solid #334155; }}
    .logo {{ font-size: 20px; font-weight: 700; color: #38bdf8; margin-bottom: 24px; display: inline-block; }}
    .title {{ font-size: 18px; font-weight: 600; color: #f8fafc; margin-bottom: 12px; }}
    .message {{ font-size: 14px; color: #94a3b8; line-height: 1.5; margin-bottom: 24px; }}
    .otp-box {{ background: #0f172a; border: 2px dashed #38bdf8; border-radius: 8px; text-align: center; padding: 16px; margin-bottom: 24px; letter-spacing: 6px; font-size: 32px; font-weight: 700; color: #38bdf8; font-family: monospace; }}
    .footer {{ font-size: 12px; color: #64748b; line-height: 1.4; border-top: 1px solid #334155; padding-top: 16px; }}
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">DocMe</div>
    <div class="title">Verification Code</div>
    <p class="message">Use the 6-digit verification code below to complete your {purpose.replace('_', ' ')}. This code is valid for <strong>{config.OTP_VALIDITY_SECONDS} seconds</strong> and single-use only.</p>
    <div class="otp-box">{otp}</div>
    <div class="footer">If you did not request this verification code, please ignore this message. Do not share this code with anyone.</div>
  </div>
</body>
</html>
"""

    if config.RESEND_API_KEY and config.RESEND_API_KEY.strip():
        return _send_via_resend(clean_email, otp, purpose, email_subject, text_content, html_content)

    if config.BREVO_API_KEY and config.BREVO_API_KEY.strip():
        return _send_via_brevo(clean_email, otp, purpose, email_subject, text_content, html_content)

    if config.SENDGRID_API_KEY and config.SENDGRID_API_KEY.strip():
        return _send_via_sendgrid(clean_email, otp, purpose, email_subject, text_content, html_content)

    if config.SMTP_HOST and config.SMTP_HOST.strip():
        return _send_via_smtp(clean_email, otp, purpose, email_subject, text_content, html_content)

    logger.error("No email delivery provider configured. Set RESEND_API_KEY, BREVO_API_KEY, or SMTP_HOST.")
    raise EmailDeliveryError("Email delivery service is not configured. Please contact the administrator.")
