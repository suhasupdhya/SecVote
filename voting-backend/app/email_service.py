import os
import ssl
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import logging
import typing
import typing_extensions
from dotenv import load_dotenv

# Ensure environment variables are loaded
load_dotenv(override=True)
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"), override=True)
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"), override=True)

# Polyfill for Python 3.7 typing.Literal compatibility with Resend SDK
if not hasattr(typing, "Literal"):
    typing.Literal = typing_extensions.Literal

import resend

logger = logging.getLogger("secvote.email")


def _send_via_smtp(recipient_email: str, otp_code: str, election_title: str, html_content: str) -> bool:
    """
    Sends OTP using standard SMTP (e.g. Gmail App Password) which has no domain restrictions.
    Allows sending to ANY recipient email (SRMIST @srmist.edu.in, Gmail, Outlook, etc.).
    """
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "465"))
    smtp_user = os.getenv("SMTP_USER")
    smtp_password = os.getenv("SMTP_PASSWORD")

    if not smtp_user or not smtp_password:
        return False

    # Clean password of any spaces (e.g. Google App Password "xxxx yyyy zzzz wwww")
    clean_password = smtp_password.replace(" ", "").strip()
    sender_name = os.getenv("SMTP_SENDER_NAME", "SecVote Voting System")
    sender_email = smtp_user.strip()

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"SecVote Verification Code for {election_title}"
    msg["From"] = f"{sender_name} <{sender_email}>"
    msg["To"] = recipient_email

    text_content = (
        f"SecVote Verification Code for {election_title}\n\n"
        f"Your 6-digit verification code: {otp_code}\n\n"
        f"Security Notice: This code expires in 5 minutes. Do not share it with anyone."
    )
    msg.attach(MIMEText(text_content, "plain"))
    msg.attach(MIMEText(html_content, "html"))

    try:
        context = ssl.create_default_context()
        if smtp_port == 465:
            with smtplib.SMTP_SSL(smtp_host, smtp_port, context=context, timeout=12) as server:
                server.login(sender_email, clean_password)
                server.sendmail(sender_email, [recipient_email], msg.as_string())
        else:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=12) as server:
                server.starttls(context=context)
                server.login(sender_email, clean_password)
                server.sendmail(sender_email, [recipient_email], msg.as_string())

        print(f"\n[SEC VOTE GMAIL SMTP SUCCESS] Successfully delivered OTP {otp_code} to '{recipient_email}' via {sender_email}!\n")
        logger.info(f"Successfully dispatched OTP verification email to recipient '{recipient_email}' via SMTP.")
        return True
    except Exception as e:
        print(f"\n[SEC VOTE SMTP ERROR] Failed to dispatch email via SMTP to '{recipient_email}': {str(e)}")
        logger.error(f"Failed to dispatch SMTP OTP email to '{recipient_email}': {str(e)}")
        return False


def send_otp_email(recipient_email: str, otp_code: str, election_title: str) -> bool:
    """
    Sends a 6-digit OTP verification code to the voter's registered email.
    
    Order of operations:
    1. If SMTP_USER & SMTP_PASSWORD are set (e.g. Gmail App Password), sends via SMTP directly to ANY email.
    2. Otherwise, falls back to Resend API.
    3. If both fail or are unconfigured, logs the local fallback OTP in the backend console.
    """
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>SecVote Verification Code</title>
      <style>
        body {{
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          background-color: #020617;
          color: #f8fafc;
          margin: 0;
          padding: 30px 15px;
        }}
        .container {{
          max-width: 500px;
          margin: 0 auto;
          background-color: #0f172a;
          border: 1px solid #1e293b;
          border-radius: 16px;
          padding: 32px;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
        }}
        .logo {{
          font-size: 20px;
          font-weight: 800;
          color: #818cf8;
          letter-spacing: -0.5px;
          margin-bottom: 24px;
        }}
        .heading {{
          font-size: 18px;
          font-weight: 700;
          color: #ffffff;
          margin-top: 0;
          margin-bottom: 8px;
        }}
        .subtitle {{
          font-size: 13px;
          color: #94a3b8;
          margin-bottom: 24px;
          line-height: 1.5;
        }}
        .otp-box {{
          background-color: #020617;
          border: 1px solid #312e81;
          border-radius: 12px;
          padding: 16px;
          text-align: center;
          margin-bottom: 24px;
        }}
        .otp-code {{
          font-family: 'Courier New', Courier, monospace;
          font-size: 32px;
          font-weight: 800;
          letter-spacing: 8px;
          color: #818cf8;
        }}
        .warning {{
          font-size: 12px;
          color: #f59e0b;
          background-color: rgba(245, 158, 11, 0.1);
          border: 1px solid rgba(245, 158, 11, 0.2);
          border-radius: 8px;
          padding: 12px;
          margin-bottom: 24px;
          line-height: 1.4;
        }}
        .footer {{
          font-size: 11px;
          color: #64748b;
          text-align: center;
          border-top: 1px solid #1e293b;
          padding-top: 16px;
        }}
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">SecVote &bull; Verification</div>
        <h1 class="heading">Identity Verification Code</h1>
        <p class="subtitle">
          You are requesting entry to the voting booth for <strong>{election_title}</strong>.
          Use the 6-digit verification code below to authenticate your session.
        </p>

        <div class="otp-box">
          <div class="otp-code">{otp_code}</div>
        </div>

        <div class="warning">
          <strong>Security Reminder:</strong> This code expires in <strong>5 minutes</strong>. Do not share this code with anyone. SecVote administrators will never ask for your verification code.
        </div>

        <div class="footer">
          SecVote Blockchain E-Voting System &bull; Private & Verifiable Elections
        </div>
      </div>
    </body>
    </html>
    """

    # 1. Primary Strategy: Try sending via SMTP (Gmail) if configured
    if os.getenv("SMTP_USER") and os.getenv("SMTP_PASSWORD"):
        smtp_success = _send_via_smtp(recipient_email, otp_code, election_title, html_content)
        if smtp_success:
            return True
        print("[SEC VOTE EMAIL] SMTP failed, attempting Resend fallback...")

    # 2. Secondary Strategy: Try sending via Resend API
    api_key = os.getenv("RESEND_API_KEY")
    sender_email = os.getenv("RESEND_SENDER_EMAIL", "onboarding@resend.dev")

    if api_key:
        try:
            resend.api_key = api_key
            params = {
                "from": sender_email,
                "to": [recipient_email],
                "subject": f"SecVote Verification Code for {election_title}",
                "html": html_content,
            }
            res = resend.Emails.send(params)
            print(f"\n[SEC VOTE RESEND EMAIL SUCCESS] Sent OTP to '{recipient_email}'. Resend ID: {res}\n")
            logger.info(f"Successfully dispatched OTP verification email to recipient '{recipient_email}'.")
            return True
        except Exception as e:
            print(f"\n[SEC VOTE RESEND EMAIL ERROR] Failed to dispatch email to '{recipient_email}': {str(e)}")
            logger.error(f"Failed to dispatch Resend OTP email to '{recipient_email}': {str(e)}")

    # 3. Fallback: Always print in console so local dev/testing is never blocked
    print(f"[SEC VOTE LOCAL FALLBACK OTP] Verification code for '{recipient_email}': {otp_code}\n")
    return False
