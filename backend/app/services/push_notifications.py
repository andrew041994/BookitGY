from __future__ import annotations

import logging
from typing import Iterable, Optional

import requests
from sqlalchemy.orm import Session

from app import models
from app.utils.time import now_guyana

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


def _is_valid_expo_token(token: Optional[str]) -> bool:
    return isinstance(token, str) and token.startswith("ExponentPushToken[") and token.endswith("]")


def upsert_push_token(
    db: Session,
    *,
    user_id: int,
    expo_push_token: str,
    platform: Optional[str] = None,
    device_id: Optional[str] = None,
) -> models.PushToken:
    token = (expo_push_token or "").strip()
    if not _is_valid_expo_token(token):
        raise ValueError("Invalid Expo push token")

    existing = (
        db.query(models.PushToken)
        .filter(models.PushToken.expo_push_token == token)
        .first()
    )

    now = now_guyana()
    if existing:
        existing.user_id = user_id
        existing.platform = platform or existing.platform
        existing.device_id = device_id or existing.device_id
        existing.is_active = True
        existing.last_seen_at = now
        db.commit()
        db.refresh(existing)
        return existing

    row = models.PushToken(
        user_id=user_id,
        expo_push_token=token,
        platform=platform,
        device_id=device_id,
        is_active=True,
        last_seen_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def deactivate_push_token(
    db: Session,
    *,
    user_id: int,
    expo_push_token: Optional[str] = None,
    device_id: Optional[str] = None,
) -> int:
    token_value = (expo_push_token or "").strip() or None
    device_value = (device_id or "").strip() or None
    if not token_value and not device_value:
        raise ValueError("expo_push_token or device_id is required")

    query = db.query(models.PushToken).filter(models.PushToken.user_id == user_id)
    if token_value:
        query = query.filter(models.PushToken.expo_push_token == token_value)
    elif device_value:
        query = query.filter(models.PushToken.device_id == device_value)

    rows = query.all()
    for row in rows:
        row.is_active = False
    if rows:
        db.commit()
    return len(rows)


def _active_tokens_for_user(db: Session, user_id: int) -> list[models.PushToken]:
    return (
        db.query(models.PushToken)
        .filter(models.PushToken.user_id == user_id, models.PushToken.is_active.is_(True))
        .all()
    )


def _deactivate_tokens(db: Session, tokens: Iterable[str]) -> None:
    tokens = [t for t in tokens if t]
    if not tokens:
        return
    rows = db.query(models.PushToken).filter(models.PushToken.expo_push_token.in_(tokens)).all()
    for row in rows:
        row.is_active = False
    if rows:
        db.commit()


def send_push_to_user(
    db: Session,
    *,
    user_id: int,
    title: str,
    body: str,
    data: Optional[dict] = None,
) -> None:
    rows = _active_tokens_for_user(db, user_id)
    if not rows:
        return

    invalid_tokens: list[str] = []
    for row in rows:
        token = row.expo_push_token
        if not _is_valid_expo_token(token):
            invalid_tokens.append(token)
            continue

        payload = {
            "to": token,
            "sound": "default",
            "title": title,
            "body": body,
            "data": data or {},
        }
        try:
            response = requests.post(EXPO_PUSH_URL, json=payload, timeout=5)
            result = response.json() if response.content else {}
            item = (result.get("data") or {}) if isinstance(result, dict) else {}
            if item.get("status") == "error":
                details = item.get("details") or {}
                if details.get("error") == "DeviceNotRegistered":
                    invalid_tokens.append(token)
        except Exception as exc:
            logger.warning("Push send failed for user_id=%s token=%s error=%s", user_id, token, exc)

    if invalid_tokens:
        _deactivate_tokens(db, invalid_tokens)
