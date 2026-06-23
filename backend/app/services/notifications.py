"""
Task 12 — Notifications service.

Sends alerts via email (SMTP) and/or Slack webhooks on:
  - Order fills
  - Emergency stop triggered
  - Daily P&L summary
  - Risk limit breach (max daily loss exceeded)

Configuration via environment variables (add to .env):
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, NOTIFY_EMAIL
  SLACK_WEBHOOK_URL
"""
from __future__ import annotations

import logging
import smtplib
import ssl
from email.mime.text import MIMEText

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


def _smtp_config() -> dict | None:
    host = getattr(settings, "SMTP_HOST", None)
    user = getattr(settings, "SMTP_USER", None)
    pwd  = getattr(settings, "SMTP_PASSWORD", None)
    to   = getattr(settings, "NOTIFY_EMAIL", None)
    port = int(getattr(settings, "SMTP_PORT", 587))
    if not (host and user and pwd and to):
        return None
    return {"host": host, "port": port, "user": user, "password": pwd, "to": to}


def _slack_url() -> str | None:
    return getattr(settings, "SLACK_WEBHOOK_URL", None)


def _send_email(subject: str, body: str) -> None:
    cfg = _smtp_config()
    if not cfg:
        logger.debug("Email notifications not configured (SMTP_HOST/SMTP_USER/SMTP_PASSWORD/NOTIFY_EMAIL missing)")
        return
    try:
        msg = MIMEText(body, "plain")
        msg["Subject"] = f"[TradingPlatform] {subject}"
        msg["From"]    = cfg["user"]
        msg["To"]      = cfg["to"]
        ctx = ssl.create_default_context()
        with smtplib.SMTP(cfg["host"], cfg["port"]) as s:
            s.ehlo()
            s.starttls(context=ctx)
            s.login(cfg["user"], cfg["password"])
            s.sendmail(cfg["user"], cfg["to"], msg.as_string())
        logger.info("Email sent: %s", subject)
    except Exception as exc:
        logger.warning("Email send failed: %s", exc)


def _send_slack(subject: str, body: str) -> None:
    url = _slack_url()
    if not url:
        logger.debug("Slack notifications not configured (SLACK_WEBHOOK_URL missing)")
        return
    try:
        payload = {"text": f"*{subject}*\n{body}"}
        r = httpx.post(url, json=payload, timeout=10)
        if r.status_code != 200:
            logger.warning("Slack webhook error %s: %s", r.status_code, r.text)
        else:
            logger.info("Slack notification sent: %s", subject)
    except Exception as exc:
        logger.warning("Slack send failed: %s", exc)


def _notify(subject: str, body: str) -> None:
    _send_email(subject, body)
    _send_slack(subject, body)


# ── Public notification functions ──────────────────────────────

def notify_order_fill(
    symbol: str,
    side: str,
    qty: float,
    fill_price: float,
    order_id: str,
    broker: str,
) -> None:
    subject = f"Order filled: {side.upper()} {qty} {symbol} @ ${fill_price:.2f}"
    body = (
        f"Order ID  : {order_id}\n"
        f"Broker    : {broker}\n"
        f"Symbol    : {symbol}\n"
        f"Side      : {side.upper()}\n"
        f"Qty       : {qty}\n"
        f"Fill price: ${fill_price:.2f}\n"
        f"Total     : ${qty * fill_price:,.2f}"
    )
    _notify(subject, body)


def notify_emergency_stop(configs_disabled: int, orders_cancelled: int) -> None:
    subject = "EMERGENCY STOP executed"
    body = (
        f"Emergency stop was triggered.\n"
        f"Automation configs disabled : {configs_disabled}\n"
        f"Open orders cancelled       : {orders_cancelled}\n\n"
        "Log in to review your positions."
    )
    _notify(subject, body)


def notify_risk_limit(
    broker: str,
    account_id: str,
    daily_loss_usd: float,
    limit_usd: float,
) -> None:
    subject = f"RISK LIMIT BREACHED — daily loss ${daily_loss_usd:,.2f}"
    body = (
        f"Account   : {account_id} ({broker})\n"
        f"Daily loss: ${daily_loss_usd:,.2f}\n"
        f"Limit     : ${limit_usd:,.2f}\n\n"
        "Automation has been paused. Review positions immediately."
    )
    _notify(subject, body)


def notify_daily_summary(
    broker: str,
    account_id: str,
    equity: float,
    daily_pnl: float,
    open_positions: int,
    signals_fired: int,
) -> None:
    sign = "+" if daily_pnl >= 0 else ""
    subject = f"Daily summary: {sign}${daily_pnl:,.2f} ({sign}{daily_pnl/equity*100:.1f}%)"
    body = (
        f"Account         : {account_id} ({broker})\n"
        f"Equity          : ${equity:,.2f}\n"
        f"Daily P&L       : {sign}${daily_pnl:,.2f}\n"
        f"Open positions  : {open_positions}\n"
        f"Signals fired   : {signals_fired}\n"
    )
    _notify(subject, body)
