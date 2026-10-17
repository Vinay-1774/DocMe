import logging
import socket
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx
import pytest

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from backend.app import config
from backend.app.email import (
    EmailDeliveryError,
    IPv4SMTP,
    IPv4SMTP_SSL,
    _send_via_brevo,
    _send_via_resend,
    _send_via_sendgrid,
    _send_via_smtp,
    send_otp_email,
)

SAMPLE_SUBJECT = "DocMe Verification Code"
SAMPLE_TEXT = "Your code is 123456"
SAMPLE_HTML = "<p>Your code is 123456</p>"


def test_send_via_resend_success():
    with patch.object(config, "RESEND_API_KEY", "re_test_key"), \
         patch("httpx.Client.post") as mock_post:
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"id": "resend_msg_123"}
        mock_post.return_value = mock_response

        _send_via_resend(
            to_email="user@example.com",
            otp="123456",
            purpose="registration",
            email_subject=SAMPLE_SUBJECT,
            text_content=SAMPLE_TEXT,
            html_content=SAMPLE_HTML,
        )

        mock_post.assert_called_once()
        args, kwargs = mock_post.call_args
        assert args[0] == "https://api.resend.com/emails"
        assert kwargs["headers"]["Authorization"] == "Bearer re_test_key"
        assert kwargs["json"]["to"] == ["user@example.com"]
        assert "123456" in kwargs["json"]["html"]


def test_send_via_resend_api_error():
    with patch.object(config, "RESEND_API_KEY", "re_test_key"), \
         patch("httpx.Client.post") as mock_post:
        mock_response = MagicMock()
        mock_response.status_code = 403
        mock_response.text = '{"message": "Domain not verified"}'
        mock_post.return_value = mock_response

        with pytest.raises(EmailDeliveryError) as exc_info:
            _send_via_resend(
                to_email="user@example.com",
                otp="123456",
                purpose="registration",
                email_subject=SAMPLE_SUBJECT,
                text_content=SAMPLE_TEXT,
                html_content=SAMPLE_HTML,
            )
        assert "Resend delivery error (HTTP 403)" in str(exc_info.value)


def test_send_via_brevo_success():
    with patch.object(config, "BREVO_API_KEY", "xkeysib-test"), \
         patch("httpx.Client.post") as mock_post:
        mock_response = MagicMock()
        mock_response.status_code = 201
        mock_response.json.return_value = {"messageId": "<brevo_msg_123>"}
        mock_post.return_value = mock_response

        _send_via_brevo(
            to_email="user@example.com",
            otp="654321",
            purpose="password_reset",
            email_subject=SAMPLE_SUBJECT,
            text_content=SAMPLE_TEXT,
            html_content=SAMPLE_HTML,
        )

        mock_post.assert_called_once()
        args, kwargs = mock_post.call_args
        assert args[0] == "https://api.brevo.com/v3/smtp/email"
        assert kwargs["headers"]["api-key"] == "xkeysib-test"
        assert kwargs["json"]["to"] == [{"email": "user@example.com"}]
        assert SAMPLE_HTML in kwargs["json"]["htmlContent"]


def test_send_via_brevo_network_error():
    with patch.object(config, "BREVO_API_KEY", "xkeysib-test"), \
         patch("httpx.Client.post", side_effect=httpx.ConnectError("Connection timed out")):
        with pytest.raises(EmailDeliveryError) as exc_info:
            _send_via_brevo(
                to_email="user@example.com",
                otp="654321",
                purpose="password_reset",
                email_subject=SAMPLE_SUBJECT,
                text_content=SAMPLE_TEXT,
                html_content=SAMPLE_HTML,
            )
        assert "Brevo HTTPS request failed" in str(exc_info.value)


def test_send_via_sendgrid_success():
    with patch.object(config, "SENDGRID_API_KEY", "SG.test"), \
         patch("httpx.Client.post") as mock_post:
        mock_response = MagicMock()
        mock_response.status_code = 202
        mock_post.return_value = mock_response

        _send_via_sendgrid(
            to_email="user@example.com",
            otp="789012",
            purpose="registration",
            email_subject=SAMPLE_SUBJECT,
            text_content=SAMPLE_TEXT,
            html_content=SAMPLE_HTML,
        )

        mock_post.assert_called_once()
        args, kwargs = mock_post.call_args
        assert args[0] == "https://api.sendgrid.com/v3/mail/send"
        assert kwargs["headers"]["Authorization"] == "Bearer SG.test"


def test_send_otp_email_provider_routing():
    # 1. When RESEND_API_KEY is configured, it routes to Resend
    with patch.object(config, "RESEND_API_KEY", "re_test_key"), \
         patch("backend.app.email._send_via_resend") as mock_resend:
        send_otp_email("test@example.com", "111222", "registration", 30)
        assert mock_resend.called
        assert mock_resend.call_args[0][0] == "test@example.com"
        assert mock_resend.call_args[0][1] == "111222"

    # 2. When only BREVO_API_KEY is configured, it routes to Brevo
    with patch.object(config, "RESEND_API_KEY", ""), \
         patch.object(config, "BREVO_API_KEY", "xkeysib-test"), \
         patch("backend.app.email._send_via_brevo") as mock_brevo:
        send_otp_email("test@example.com", "111222", "registration", 30)
        assert mock_brevo.called
        assert mock_brevo.call_args[0][0] == "test@example.com"
        assert mock_brevo.call_args[0][1] == "111222"

    # 3. When only SENDGRID_API_KEY is configured, it routes to SendGrid
    with patch.object(config, "RESEND_API_KEY", ""), \
         patch.object(config, "BREVO_API_KEY", ""), \
         patch.object(config, "SENDGRID_API_KEY", "SG.test"), \
         patch("backend.app.email._send_via_sendgrid") as mock_sg:
        send_otp_email("test@example.com", "111222", "registration", 30)
        assert mock_sg.called
        assert mock_sg.call_args[0][0] == "test@example.com"
        assert mock_sg.call_args[0][1] == "111222"


def test_smtp_diagnostic_on_errno_101(caplog):
    """Verifies that OSError 101 Network is unreachable triggers diagnostic logs recommending HTTPS API."""
    with patch.object(config, "RESEND_API_KEY", ""), \
         patch.object(config, "BREVO_API_KEY", ""), \
         patch.object(config, "SENDGRID_API_KEY", ""):
        
        # Mock IPv4SMTP to raise OSError 101
        with patch("backend.app.email.IPv4SMTP", side_effect=OSError(101, "Network is unreachable")):
            with caplog.at_level(logging.ERROR):
                with pytest.raises(EmailDeliveryError) as exc_info:
                    _send_via_smtp("test@example.com", "123456", "registration", SAMPLE_SUBJECT, SAMPLE_TEXT, SAMPLE_HTML)

            assert "SMTP network connection FAILED" in caplog.text
            assert "Render" in caplog.text
            assert "RESEND_API_KEY" in caplog.text
            # Crucial: OTP code or password MUST NOT be in the logs
            assert "123456" not in caplog.text
            assert "Network is unreachable" in str(exc_info.value)


def test_smtp_diagnostic_on_dns_failure(caplog):
    """Verifies that DNS failure is clearly logged."""
    with patch.object(config, "RESEND_API_KEY", ""), \
         patch.object(config, "BREVO_API_KEY", ""), \
         patch.object(config, "SENDGRID_API_KEY", ""):
        
        with patch("socket.getaddrinfo", side_effect=socket.gaierror(-2, "Name or service not known")):
            with caplog.at_level(logging.ERROR):
                with pytest.raises(EmailDeliveryError) as exc_info:
                    _send_via_smtp("test@example.com", "123456", "registration", SAMPLE_SUBJECT, SAMPLE_TEXT, SAMPLE_HTML)

            assert "SMTP DNS resolution FAILED" in caplog.text
            assert "Name or service not known" in str(exc_info.value)
            assert "123456" not in caplog.text
