from datetime import datetime, timedelta, timezone

# Guyana is UTC-4 with no daylight saving time.
GUYANA_TIMEZONE = timezone(timedelta(hours=-4))


def now_guyana() -> datetime:
    """Return the current Guyana local time as a naive ``datetime``.

    Datetimes in the database are stored without timezone info but represent
    Guyana local time. This helper ensures code uses the same convention.
    """

    return datetime.now(GUYANA_TIMEZONE).replace(tzinfo=None)


def today_start_guyana() -> datetime:
    """Return midnight (start) of the current day in Guyana local time."""

    now = now_guyana()
    return datetime(now.year, now.month, now.day)


def today_end_guyana() -> datetime:
    """Return 23:59:59 of the current day in Guyana local time."""

    start = today_start_guyana()
    return start + timedelta(hours=23, minutes=59, seconds=59)
