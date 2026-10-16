import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from . import config

logger = logging.getLogger(__name__)


class EmailDeliveryError(Exception):
    """Raised when email delivery fails via the configured provider/SMTP server."""
    pass


def send_otp_email(
    to_email: str,
    otp: str,
    purpose: str = "registration",
    subject: Optional[str] = None,
) -> bool:
    """
    Delivers a verification OTP email via configured SMTP settings.
    Does NOT log the plaintext OTP or claim success when sending fails.
    """
    smtp_host = config.SMTP_HOST
    smtp_port = config.SMTP_PORT
    smtp_user = config.SMTP_USER
    smtp_password = config.SMTP_PASSWORD
    smtp_from_email = config.SMTP_FROM_EMAIL
    smtp_use_ssl = config.SMTP_USE_SSL
    smtp_use_tls = config.SMTP_USE_TLS
    smtp_timeout = config.SMTP_TIMEOUT_SECONDS

    if not smtp_host:
        logger.error("SMTP_HOST is not configured; cannot deliver verification email to %s", to_email)
        raise EmailDeliveryError("Email delivery service is not configured. Please contact the administrator.")

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

    msg = MIMEMultipart("alternative")
    msg["Subject"] = email_subject
    msg["From"] = smtp_from_email
    msg["To"] = clean_email

    msg.attach(MIMEText(text_content, "plain", "utf-8"))
    msg.attach(MIMEText(html_content, "html", "utf-8"))

    try:
        if smtp_use_ssl:
            with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=smtp_timeout) as server:
                if smtp_user and smtp_password:
                    server.login(smtp_user, smtp_password)
                server.send_message(msg)
        else:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=smtp_timeout) as server:
                if smtp_use_tls:
                    server.starttls()
                if smtp_user and smtp_password:
                    server.login(smtp_user, smtp_password)
                server.send_message(msg)

        logger.info("Successfully dispatched OTP verification email to recipient %s", clean_email)
        return True

    except Exception as exc:
        # Never log the plaintext OTP or secrets
        err_msg = str(exc)
        if smtp_password and smtp_password in err_msg:
            err_msg = err_msg.replace(smtp_password, "[REDACTED]")
        if otp and otp in err_msg:
            err_msg = err_msg.replace(otp, "[REDACTED]")
        logger.error(
            "Failed to send OTP verification email to %s: %s - %s",
            clean_email,
            type(exc).__name__,
            err_msg,
        )
        raise EmailDeliveryError(f"Failed to deliver verification email: {type(exc).__name__}") from exc
