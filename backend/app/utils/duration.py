from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional, Tuple


def validate_duration_parts(days: int = 0, hours: int = 0, minutes_part: int = 0) -> Tuple[int, int, int]:
    days = int(days or 0)
    hours = int(hours or 0)
    minutes_part = int(minutes_part or 0)

    if days < 0:
        raise ValueError("duration_days cannot be negative")
    if hours < 0:
        raise ValueError("duration_hours cannot be negative")
    if minutes_part < 0:
        raise ValueError("duration_minutes_part cannot be negative")

    # Normalize overflow values into canonical ranges.
    extra_hours, normalized_minutes = divmod(minutes_part, 60)
    hours += extra_hours
    extra_days, normalized_hours = divmod(hours, 24)
    days += extra_days

    return days, normalized_hours, normalized_minutes


def duration_parts_to_minutes(days: int = 0, hours: int = 0, minutes_part: int = 0) -> int:
    days, hours, minutes_part = validate_duration_parts(days, hours, minutes_part)
    total = (days * 1440) + (hours * 60) + minutes_part
    if total <= 0:
        raise ValueError("Duration must be greater than 0 minutes")
    return total


def minutes_to_duration_parts(total_minutes: int) -> Tuple[int, int, int]:
    total = int(total_minutes or 0)
    if total < 0:
        raise ValueError("duration_minutes cannot be negative")

    days, rem = divmod(total, 1440)
    hours, minutes_part = divmod(rem, 60)
    return days, hours, minutes_part


def derive_booking_end(start_at: datetime, duration_minutes: int) -> datetime:
    return start_at + timedelta(minutes=int(duration_minutes or 0))


def format_duration_human(total_minutes: Optional[int]) -> str:
    minutes = int(total_minutes or 0)
    days, hours, mins = minutes_to_duration_parts(minutes)
    chunks = []
    if days:
        chunks.append(f"{days} day" + ("s" if days != 1 else ""))
    if hours:
        chunks.append(f"{hours} hr")
    if mins or not chunks:
        chunks.append(f"{mins} min")
    return " ".join(chunks)
