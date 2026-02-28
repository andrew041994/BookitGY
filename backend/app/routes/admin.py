import logging
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from typing import List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import and_, case, func, literal
from sqlalchemy.orm import Session

from app import crud, schemas, models
from app.utils.email import send_billing_paid_email, send_provider_suspension_email
from app.database import get_db
from app.security import get_current_user_from_header

router = APIRouter(prefix="/admin", tags=["admin"])
logger = logging.getLogger(__name__)


def _require_admin(current_user: models.User = Depends(get_current_user_from_header)) -> models.User:
    if not getattr(current_user, "is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


def _normalize_profession_filter(
    db: Session,
    profession: Optional[str],
):
    normalized_profession = (profession or "all").strip()
    provider_ids_subquery = None
    if (
        normalized_profession
        and normalized_profession.lower() != "all"
        and hasattr(models, "ProviderProfession")
    ):
        provider_ids_subquery = (
            db.query(models.ProviderProfession.provider_id)
            .filter(models.ProviderProfession.name.ilike(normalized_profession))
            .subquery()
        )
    return normalized_profession or "all", provider_ids_subquery


def _profession_label_expression(db: Session):
    if hasattr(models, "ProviderProfession"):
        return (
            db.query(models.ProviderProfession.name)
            .filter(models.ProviderProfession.provider_id == models.Provider.id)
            .order_by(models.ProviderProfession.name.asc())
            .limit(1)
            .scalar_subquery()
        )
    return literal(None)


def _iter_months(start: date, end: date) -> List[str]:
    current = date(start.year, start.month, 1)
    end_month = date(end.year, end.month, 1)
    months: List[str] = []
    while current <= end_month:
        months.append(current.strftime("%Y-%m"))
        if current.month == 12:
            current = date(current.year + 1, 1, 1)
        else:
            current = date(current.year, current.month + 1, 1)
    return months


def _add_months(start: date, months: int) -> date:
    month_index = start.month - 1 + months
    year = start.year + month_index // 12
    month = month_index % 12 + 1
    return date(year, month, 1)


def _month_key_expr(db: Session, dt_col):
    dialect = getattr(getattr(db, "bind", None), "dialect", None)
    name = getattr(dialect, "name", "") if dialect else ""
    if name == "sqlite":
        return func.strftime("%Y-%m", dt_col)
    return func.to_char(dt_col, "YYYY-MM")


@router.get("/service-charge", response_model=schemas.ServiceChargeOut)
def get_service_charge(
    db: Session = Depends(get_db),
    _: models.User = Depends(_require_admin),
):
    pct = crud.get_platform_service_charge_percentage(db)
    return {"service_charge_percentage": float(pct)}


@router.put("/service-charge", response_model=schemas.ServiceChargeOut)
def update_service_charge(
    payload: schemas.ServiceChargeUpdate,
    db: Session = Depends(get_db),
    _: models.User = Depends(_require_admin),
):
    pct = crud.update_platform_service_charge(db, payload.service_charge_percentage)
    return {"service_charge_percentage": float(pct)}


@router.get("/providers/locations", response_model=List[schemas.AdminProviderLocationOut])
def list_provider_locations(
    db: Session = Depends(get_db),
    _: models.User = Depends(_require_admin),
):
    return crud.list_admin_provider_locations(db)




@router.get("/clients/list", response_model=List[schemas.AdminClientListItemOut])
def list_clients(
    search: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _: models.User = Depends(_require_admin),
):
    query = (
        db.query(
            models.User.id.label("id"),
            models.User.username.label("username"),
            models.User.whatsapp.label("whatsapp"),
            models.User.email.label("email"),
            models.User.created_at.label("created_at"),
        )
        .filter(models.User.is_provider.is_(False), models.User.is_admin.is_(False))
    )

    normalized_search = (search or "").strip()
    if normalized_search:
        pattern = f"%{normalized_search}%"
        query = query.filter(
            (models.User.username.ilike(pattern))
            | (models.User.whatsapp.ilike(pattern))
        )

    rows = (
        query
        .order_by(models.User.id.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )

    return [
        {
            "id": row.id,
            "username": row.username,
            "whatsapp": row.whatsapp,
            "email": row.email,
            "created_at": row.created_at,
        }
        for row in rows
    ]


@router.get("/providers/list", response_model=List[schemas.AdminProviderListItemOut])
def list_providers(
    search: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _: models.User = Depends(_require_admin),
):
    profession_expr = _profession_label_expression(db)

    query = (
        db.query(
            models.Provider.id.label("id"),
            models.User.username.label("username"),
            models.Provider.account_number.label("account_number"),
            profession_expr.label("profession"),
            models.User.whatsapp.label("whatsapp"),
            models.User.email.label("email"),
        )
        .join(models.User, models.Provider.user_id == models.User.id)
    )

    normalized_search = (search or "").strip()
    if normalized_search:
        pattern = f"%{normalized_search}%"
        query = query.filter(
            (models.User.username.ilike(pattern))
            | (models.User.whatsapp.ilike(pattern))
        )

    rows = (
        query
        .order_by(models.Provider.id.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )

    return [
        {
            "id": row.id,
            "username": row.username,
            "account_number": row.account_number,
            "profession": row.profession,
            "whatsapp": row.whatsapp,
            "email": row.email,
        }
        for row in rows
    ]


@router.get("/cancellations", response_model=List[schemas.AdminProviderCancellationOut])
def list_provider_cancellations(
    month: int = Query(..., ge=1, le=12),
    year: int = Query(..., ge=2000),
    db: Session = Depends(get_db),
    _: models.User = Depends(_require_admin),
):
    try:
        return crud.list_admin_cancellation_stats(db, month=month, year=year)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/reports/signups", response_model=schemas.AdminSignupReportOut)
def get_signup_report(
    start: date = Query(...),
    end: date = Query(...),
    db: Session = Depends(get_db),
    _: models.User = Depends(_require_admin),
):
    if start > end:
        raise HTTPException(status_code=400, detail="Start date must be on or before end date")

    start_ts = datetime.combine(start, time.min)
    end_ts_exclusive = datetime.combine(end + timedelta(days=1), time.min)

    providers_count, clients_count = (
        db.query(
            func.coalesce(
                func.sum(case((models.User.is_provider.is_(True), 1), else_=0)),
                0,
            ),
            func.coalesce(
                func.sum(case((models.User.is_provider.is_(False), 1), else_=0)),
                0,
            ),
        )
        .filter(models.User.created_at >= start_ts)
        .filter(models.User.created_at < end_ts_exclusive)
        .one()
    )

    total_providers, total_clients = (
        db.query(
            func.coalesce(
                func.sum(case((models.User.is_provider.is_(True), 1), else_=0)),
                0,
            ),
            func.coalesce(
                func.sum(case((models.User.is_provider.is_(False), 1), else_=0)),
                0,
            ),
        )
        .one()
    )

    return {
        "start": start,
        "end": end,
        "providers": int(providers_count or 0),
        "clients": int(clients_count or 0),
        "total_providers": int(total_providers or 0),
        "total_clients": int(total_clients or 0),
    }

# Smoke test:
# curl -H "Authorization: Bearer <token>" "https://<backend>/admin/reports/professions"
# curl -H "Authorization: Bearer <token>" "https://<backend>/admin/reports/booking-metrics?start=2026-01-07&end=2026-01-13"

@router.get("/reports/professions", response_model=schemas.AdminProfessionsOut)
def list_professions(
    db: Session = Depends(get_db),
    _: models.User = Depends(_require_admin),
):
    professions = []
    if hasattr(models, "ProviderProfession"):
        rows = (
            db.query(models.ProviderProfession.name)
            .filter(models.ProviderProfession.name.isnot(None))
            .distinct()
            .order_by(models.ProviderProfession.name.asc())
            .all()
        )
        professions = [row[0] for row in rows if row[0]]
    return {"professions": professions}


@router.get("/reports/booking-metrics", response_model=schemas.AdminBookingMetricsOut)
def get_booking_metrics(
    start: date = Query(...),
    end: date = Query(...),
    status: Optional[str] = Query(None),
    profession: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _: models.User = Depends(_require_admin),
):
    if start > end:
        raise HTTPException(status_code=400, detail="Start date must be on or before end date")

    start_ts = datetime.combine(start, time.min)
    end_ts_exclusive = datetime.combine(end + timedelta(days=1), time.min)

    normalized_status = (status or "all").strip().lower()
    normalized_profession = (profession or "all").strip()

    provider_ids_subquery = None
    if (
        normalized_profession
        and normalized_profession.lower() != "all"
        and hasattr(models, "ProviderProfession")
    ):
        provider_ids_subquery = (
            db.query(models.ProviderProfession.provider_id)
            .filter(models.ProviderProfession.name.ilike(normalized_profession))
            .subquery()
        )

    base_query = (
        db.query(models.Booking, models.Service, models.Provider, models.User)
        .join(models.Service, models.Booking.service_id == models.Service.id)
        .join(models.Provider, models.Service.provider_id == models.Provider.id)
        .join(models.User, models.Provider.user_id == models.User.id)
        .filter(models.Booking.start_time >= start_ts)
        .filter(models.Booking.start_time < end_ts_exclusive)
    )

    if provider_ids_subquery is not None:
        base_query = base_query.filter(models.Provider.id.in_(provider_ids_subquery))

    if normalized_status and normalized_status != "all":
        if normalized_status == "upcoming":
            base_query = base_query.filter(
                models.Booking.status.in_(["confirmed", "pending"])
            )
        else:
            base_query = base_query.filter(models.Booking.status == normalized_status)

    totals = (
        base_query.with_entities(
            func.count(models.Booking.id).label("total_bookings"),
            func.coalesce(
                func.sum(
                    case(
                        (models.Booking.status.in_(["confirmed", "pending"]), 1),
                        else_=0,
                    )
                ),
                0,
            ).label("upcoming"),
            func.coalesce(
                func.sum(case((models.Booking.status == "completed", 1), else_=0)),
                0,
            ).label("completed"),
            func.coalesce(
                func.sum(case((models.Booking.status == "cancelled", 1), else_=0)),
                0,
            ).label("cancelled"),
            func.coalesce(func.sum(models.Service.price_gyd), 0.0).label("total_revenue"),
        )
        .one()
    )

    profession_label = None
    if hasattr(models, "ProviderProfession"):
        profession_label = (
            db.query(models.ProviderProfession.name)
            .filter(models.ProviderProfession.provider_id == models.Provider.id)
            .order_by(models.ProviderProfession.name.asc())
            .limit(1)
            .scalar_subquery()
        )
    profession_label_expr = profession_label if profession_label is not None else literal(None)

    provider_rows = (
        base_query.with_entities(
            models.Provider.id.label("provider_id"),
            models.User.username.label("provider_name"),
            profession_label_expr.label("profession"),
            func.count(models.Booking.id).label("total_bookings"),
            func.coalesce(
                func.sum(
                    case(
                        (models.Booking.status.in_(["confirmed", "pending"]), 1),
                        else_=0,
                    )
                ),
                0,
            ).label("upcoming"),
            func.coalesce(
                func.sum(case((models.Booking.status == "completed", 1), else_=0)),
                0,
            ).label("completed"),
            func.coalesce(
                func.sum(case((models.Booking.status == "cancelled", 1), else_=0)),
                0,
            ).label("cancelled"),
        )
        .group_by(models.Provider.id, models.User.username, profession_label_expr)
        .order_by(models.User.username.asc())
        .all()
    )

    return {
        "start": start,
        "end": end,
        "status": normalized_status or "all",
        "profession": normalized_profession or "all",
        "totals": {
            "total_bookings": int(totals.total_bookings or 0),
            "upcoming": int(totals.upcoming or 0),
            "completed": int(totals.completed or 0),
            "cancelled": int(totals.cancelled or 0),
            "total_revenue": float(totals.total_revenue or 0.0),
        },
        "by_provider": [
            {
                "provider_id": row.provider_id,
                "provider_name": row.provider_name,
                "profession": row.profession,
                "total_bookings": int(row.total_bookings or 0),
                "upcoming": int(row.upcoming or 0),
                "completed": int(row.completed or 0),
                "cancelled": int(row.cancelled or 0),
            }
            for row in provider_rows
        ],
    }


@router.get(
    "/reports/provider-performance/summary",
    response_model=schemas.AdminProviderPerformanceSummaryOut,
)
def get_provider_performance_summary(
    start: date = Query(...),
    end: date = Query(...),
    profession: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _: models.User = Depends(_require_admin),
):
    if start > end:
        raise HTTPException(status_code=400, detail="Start date must be on or before end date")

    start_ts = datetime.combine(start, time.min)
    end_ts_exclusive = datetime.combine(end + timedelta(days=1), time.min)

    normalized_status = (status or "all").strip().lower()
    normalized_profession, provider_ids_subquery = _normalize_profession_filter(
        db,
        profession,
    )
    profession_label_expr = _profession_label_expression(db)

    base_query = (
        db.query(models.Booking, models.Service, models.Provider, models.User)
        .join(models.Service, models.Booking.service_id == models.Service.id)
        .join(models.Provider, models.Service.provider_id == models.Provider.id)
        .join(models.User, models.Provider.user_id == models.User.id)
        .filter(models.Booking.start_time >= start_ts)
        .filter(models.Booking.start_time < end_ts_exclusive)
    )

    if provider_ids_subquery is not None:
        base_query = base_query.filter(models.Provider.id.in_(provider_ids_subquery))

    if normalized_status and normalized_status != "all":
        base_query = base_query.filter(models.Booking.status == normalized_status)

    top_by_bookings_rows = (
        base_query.with_entities(
            models.Provider.id.label("provider_id"),
            models.User.username.label("provider_name"),
            profession_label_expr.label("profession"),
            func.count(models.Booking.id).label("total_bookings"),
        )
        .group_by(models.Provider.id, models.User.username, profession_label_expr)
        .order_by(func.count(models.Booking.id).desc(), models.User.username.asc())
        .all()
    )

    revenue_supported = hasattr(models.Service, "price_gyd")
    top_by_revenue_rows = []
    if revenue_supported:
        top_by_revenue_rows = (
            base_query.with_entities(
                models.Provider.id.label("provider_id"),
                models.User.username.label("provider_name"),
                profession_label_expr.label("profession"),
                func.coalesce(func.sum(models.Service.price_gyd), 0.0).label("total_revenue"),
            )
            .group_by(models.Provider.id, models.User.username, profession_label_expr)
            .order_by(func.coalesce(func.sum(models.Service.price_gyd), 0.0).desc())
            .all()
        )

    most_booked_services_rows = (
        base_query.with_entities(
            models.Service.id.label("service_id"),
            models.Service.name.label("service_name"),
            models.Provider.id.label("provider_id"),
            models.User.username.label("provider_name"),
            func.count(models.Booking.id).label("bookings"),
        )
        .group_by(
            models.Service.id,
            models.Service.name,
            models.Provider.id,
            models.User.username,
        )
        .order_by(func.count(models.Booking.id).desc(), models.Service.name.asc())
        .all()
    )

    cancellation_rows = (
        base_query.with_entities(
            models.Provider.id.label("provider_id"),
            models.User.username.label("provider_name"),
            profession_label_expr.label("profession"),
            func.count(models.Booking.id).label("total_bookings"),
            func.coalesce(
                func.sum(case((models.Booking.status == "cancelled", 1), else_=0)),
                0,
            ).label("cancelled"),
        )
        .group_by(models.Provider.id, models.User.username, profession_label_expr)
        .all()
    )

    high_cancellation_rates = []
    for row in cancellation_rows:
        total_bookings = int(row.total_bookings or 0)
        cancelled = int(row.cancelled or 0)
        if total_bookings <= 0:
            continue
        rate = cancelled / total_bookings if total_bookings else 0.0
        high_cancellation_rates.append(
            {
                "provider_id": row.provider_id,
                "provider_name": row.provider_name,
                "profession": row.profession,
                "cancelled": cancelled,
                "total_bookings": total_bookings,
                "cancellation_rate": round(rate, 4),
            }
        )
    high_cancellation_rates.sort(
        key=lambda item: (item["cancellation_rate"], item["total_bookings"]),
        reverse=True,
    )

    booking_filters = [
        models.Booking.start_time >= start_ts,
        models.Booking.start_time < end_ts_exclusive,
    ]
    if normalized_status and normalized_status != "all":
        booking_filters.append(models.Booking.status == normalized_status)

    low_activity_query = (
        db.query(
            models.Provider.id.label("provider_id"),
            models.User.username.label("provider_name"),
            profession_label_expr.label("profession"),
            func.count(models.Booking.id).label("bookings_in_range"),
        )
        .join(models.User, models.Provider.user_id == models.User.id)
        .outerjoin(models.Service, models.Service.provider_id == models.Provider.id)
        .outerjoin(
            models.Booking,
            and_(
                models.Booking.service_id == models.Service.id,
                *booking_filters,
            ),
        )
        .group_by(models.Provider.id, models.User.username, profession_label_expr)
        .having(func.count(models.Booking.id) <= 3)
        .order_by(func.count(models.Booking.id).asc(), models.User.username.asc())
    )

    if provider_ids_subquery is not None:
        low_activity_query = low_activity_query.filter(models.Provider.id.in_(provider_ids_subquery))

    low_activity_rows = low_activity_query.all()

    return {
        "start": start,
        "end": end,
        "filters": {
            "profession": normalized_profession or "all",
            "status": normalized_status or "all",
        },
        "revenue_supported": revenue_supported,
        "top_providers_by_bookings": [
            {
                "provider_id": row.provider_id,
                "provider_name": row.provider_name,
                "profession": row.profession,
                "total_bookings": int(row.total_bookings or 0),
            }
            for row in top_by_bookings_rows
        ],
        "top_providers_by_revenue": [
            {
                "provider_id": row.provider_id,
                "provider_name": row.provider_name,
                "profession": row.profession,
                "total_revenue": float(row.total_revenue or 0.0),
            }
            for row in top_by_revenue_rows
        ],
        "most_booked_services": [
            {
                "service_id": row.service_id,
                "service_name": row.service_name,
                "provider_id": row.provider_id,
                "provider_name": row.provider_name,
                "bookings": int(row.bookings or 0),
            }
            for row in most_booked_services_rows
        ],
        "high_cancellation_rates": high_cancellation_rates,
        "low_activity_providers": [
            {
                "provider_id": row.provider_id,
                "provider_name": row.provider_name,
                "profession": row.profession,
                "bookings_in_range": int(row.bookings_in_range or 0),
            }
            for row in low_activity_rows
        ],
    }


@router.get(
    "/reports/provider-performance/retention",
    response_model=schemas.AdminProviderRetentionOut,
)
def get_provider_retention(
    months_back: int = Query(6, ge=1),
    start: Optional[date] = Query(None),
    end: Optional[date] = Query(None),
    profession: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _: models.User = Depends(_require_admin),
):
    if start and end and start > end:
        raise HTTPException(status_code=400, detail="Start date must be on or before end date")

    if start and end:
        start_date = date(start.year, start.month, 1)
        end_date = end
    else:
        today = date.today()
        end_date = today
        start_date = _add_months(date(today.year, today.month, 1), -(months_back - 1))

    months = _iter_months(start_date, end_date)
    start_ts = datetime.combine(start_date, time.min)
    end_ts_exclusive = datetime.combine(end_date + timedelta(days=1), time.min)

    _normalized_profession, provider_ids_subquery = _normalize_profession_filter(
        db,
        profession,
    )
    profession_label_expr = _profession_label_expression(db)
    month_expr = _month_key_expr(db, models.Booking.start_time)

    retention_query = (
        db.query(
            models.Provider.id.label("provider_id"),
            models.User.username.label("provider_name"),
            profession_label_expr.label("profession"),
            month_expr.label("month"),
            func.count(models.Booking.id).label("bookings"),
        )
        .join(models.Service, models.Booking.service_id == models.Service.id)
        .join(models.Provider, models.Service.provider_id == models.Provider.id)
        .join(models.User, models.Provider.user_id == models.User.id)
        .filter(models.Booking.start_time >= start_ts)
        .filter(models.Booking.start_time < end_ts_exclusive)
        .filter(models.Booking.status != "cancelled")
        .group_by(
            models.Provider.id,
            models.User.username,
            profession_label_expr,
            month_expr,
        )
    )

    if provider_ids_subquery is not None:
        retention_query = retention_query.filter(models.Provider.id.in_(provider_ids_subquery))

    retention_rows = retention_query.all()

    providers_map = defaultdict(lambda: {"active_months": set()})
    for row in retention_rows:
        providers_map[row.provider_id]["provider_id"] = row.provider_id
        providers_map[row.provider_id]["provider_name"] = row.provider_name
        providers_map[row.provider_id]["profession"] = row.profession
        providers_map[row.provider_id]["active_months"].add(row.month)

    providers = []
    for provider_id, payload in providers_map.items():
        active_months = sorted(payload["active_months"])
        last_active = active_months[-1] if active_months else None
        providers.append(
            {
                "provider_id": provider_id,
                "provider_name": payload.get("provider_name"),
                "profession": payload.get("profession"),
                "active_months": active_months,
                "months_active_count": len(active_months),
                "is_active_every_month": len(active_months) == len(months),
                "last_active_month": last_active,
            }
        )

    providers.sort(key=lambda item: (item["months_active_count"], item["provider_name"] or ""), reverse=True)

    return {
        "months": months,
        "providers": providers,
    }


@router.get(
    "/reports/provider-performance/low-activity",
    response_model=schemas.AdminLowActivityOut,
)
def get_low_activity_providers(
    month: Optional[str] = Query(None),
    year: Optional[int] = Query(None, ge=2000),
    threshold: int = Query(3, ge=0),
    profession: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _: models.User = Depends(_require_admin),
):
    if month:
        if "-" in month:
            try:
                year_part, month_part = month.split("-")
                month_year = date(int(year_part), int(month_part), 1)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail="Invalid month format. Use YYYY-MM.") from exc
        else:
            if year is None:
                raise HTTPException(status_code=400, detail="year is required when month is numeric")
            try:
                month_year = date(year, int(month), 1)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail="Invalid year/month.") from exc
    elif year is not None:
        raise HTTPException(status_code=400, detail="month is required when year is provided")
    else:
        raise HTTPException(status_code=400, detail="month is required")

    start_ts = datetime.combine(month_year, time.min)
    next_month = _add_months(month_year, 1)
    end_ts_exclusive = datetime.combine(next_month, time.min)

    _normalized_profession, provider_ids_subquery = _normalize_profession_filter(
        db,
        profession,
    )
    profession_label_expr = _profession_label_expression(db)

    low_activity_query = (
        db.query(
            models.Provider.id.label("provider_id"),
            models.User.username.label("provider_name"),
            profession_label_expr.label("profession"),
            func.count(models.Booking.id).label("bookings"),
        )
        .join(models.User, models.Provider.user_id == models.User.id)
        .outerjoin(models.Service, models.Service.provider_id == models.Provider.id)
        .outerjoin(
            models.Booking,
            and_(
                models.Booking.service_id == models.Service.id,
                models.Booking.start_time >= start_ts,
                models.Booking.start_time < end_ts_exclusive,
            ),
        )
        .group_by(models.Provider.id, models.User.username, profession_label_expr)
        .having(func.count(models.Booking.id) <= threshold)
        .order_by(func.count(models.Booking.id).asc(), models.User.username.asc())
    )

    if provider_ids_subquery is not None:
        low_activity_query = low_activity_query.filter(models.Provider.id.in_(provider_ids_subquery))

    providers = [
        {
            "provider_id": row.provider_id,
            "provider_name": row.provider_name,
            "profession": row.profession,
            "bookings": int(row.bookings or 0),
        }
        for row in low_activity_query.all()
    ]

    return {
        "month": month_year.strftime("%Y-%m"),
        "threshold": threshold,
        "providers": providers,
    }


@router.get(
    "/reports/provider-performance/cancellation-rates",
    response_model=schemas.AdminCancellationRatesOut,
)
def get_provider_cancellation_rates(
    start: date = Query(...),
    end: date = Query(...),
    min_bookings: int = Query(5, ge=1),
    profession: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _: models.User = Depends(_require_admin),
):
    if start > end:
        raise HTTPException(status_code=400, detail="Start date must be on or before end date")

    start_ts = datetime.combine(start, time.min)
    end_ts_exclusive = datetime.combine(end + timedelta(days=1), time.min)

    normalized_profession, provider_ids_subquery = _normalize_profession_filter(
        db,
        profession,
    )
    profession_label_expr = _profession_label_expression(db)

    cancellation_query = (
        db.query(
            models.Provider.id.label("provider_id"),
            models.User.username.label("provider_name"),
            profession_label_expr.label("profession"),
            func.count(models.Booking.id).label("total"),
            func.coalesce(
                func.sum(case((models.Booking.status == "cancelled", 1), else_=0)),
                0,
            ).label("cancelled"),
        )
        .join(models.Service, models.Booking.service_id == models.Service.id)
        .join(models.Provider, models.Service.provider_id == models.Provider.id)
        .join(models.User, models.Provider.user_id == models.User.id)
        .filter(models.Booking.start_time >= start_ts)
        .filter(models.Booking.start_time < end_ts_exclusive)
        .group_by(models.Provider.id, models.User.username, profession_label_expr)
    )

    if provider_ids_subquery is not None:
        cancellation_query = cancellation_query.filter(models.Provider.id.in_(provider_ids_subquery))

    providers = []
    for row in cancellation_query.all():
        total = int(row.total or 0)
        cancelled = int(row.cancelled or 0)
        if total < min_bookings:
            continue
        rate = cancelled / total if total else 0.0
        providers.append(
            {
                "provider_id": row.provider_id,
                "provider_name": row.provider_name,
                "profession": row.profession,
                "cancelled": cancelled,
                "total": total,
                "cancellation_rate": round(rate, 4),
            }
        )

    providers.sort(key=lambda item: (item["cancellation_rate"], item["total"]), reverse=True)

    return {
        "start": start,
        "end": end,
        "min_bookings": min_bookings,
        "providers": providers,
    }


@router.post("/users/{user_id}/suspend", response_model=schemas.UserSuspensionOut)
def suspend_user(
    user_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(_require_admin),
):
    user = crud.set_user_suspension(db, user_id, True)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.post("/users/{user_id}/unsuspend", response_model=schemas.UserSuspensionOut)
def unsuspend_user(
    user_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(_require_admin),
):
    user = crud.set_user_suspension(db, user_id, False)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.post("/providers/suspension", response_model=schemas.ProviderSuspensionOut)
def update_provider_suspension(
    payload: schemas.ProviderSuspensionUpdate,
    db: Session = Depends(get_db),
    _: models.User = Depends(_require_admin),
):
    provider = (
        db.query(models.Provider)
        .filter(models.Provider.account_number == payload.account_number)
        .first()
    )

    if not provider:
        raise HTTPException(
            status_code=404,
            detail="Provider not found for account number",
        )

    user = db.query(models.User).filter(models.User.id == provider.user_id).first()
    if not user:
        raise HTTPException(
            status_code=404,
            detail="User not found for provider account number",
        )

    changed = False
    suspension_changed = False
    if payload.is_suspended is False and provider.is_locked:
        provider.is_locked = False
        changed = True

    if user.is_suspended != payload.is_suspended:
        user.is_suspended = payload.is_suspended
        changed = True
        suspension_changed = True

    if changed:
        db.commit()
        db.refresh(user)
        db.refresh(provider)

    if suspension_changed and user and user.email:
        provider_name = crud.get_display_name(user).strip() or None
        try:
            send_provider_suspension_email(
                user.email,
                account_number=provider.account_number,
                provider_name=provider_name,
                is_suspended=payload.is_suspended,
            )
        except Exception:
            action = "suspend" if payload.is_suspended else "reactivate"
            logger.exception(
                "Failed to send provider suspension email account=%s action=%s",
                provider.account_number,
                action,
            )

    return {
        "account_number": provider.account_number,
        "is_suspended": user.is_suspended,
        "is_locked": bool(provider.is_locked),
    }


@router.put(
    "/promotions/{account_number}",
    response_model=schemas.BillCreditOut,
)
def apply_bill_credit(
    account_number: str,
    payload: schemas.BillCreditUpdate,
    db: Session = Depends(get_db),
    _: models.User = Depends(_require_admin),
):
    provider = (
        db.query(models.Provider)
        .filter(models.Provider.account_number == account_number)
        .first()
    )

    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")

    credit, _applied_amount = crud.apply_bill_credit_to_current_cycle(
        db, provider, payload.credit_gyd
    )
    balance = crud.get_provider_credit_balance(db, provider.id)

    return {
        "provider_id": provider.id,
        "account_number": provider.account_number,
        "credit_applied_gyd": float(credit.amount_gyd or 0.0),
        "total_credit_balance_gyd": float(balance or 0.0),
    }


def _resolve_cycle_month(
    cycle_month: date | None,
    month: int | None,
    year: int | None,
) -> date:
    if cycle_month:
        return cycle_month
    if month is not None and year is not None:
        try:
            return date(year, month, 1)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid billing month/year") from exc
    return crud.current_billing_cycle_month()


@router.get("/billing", response_model=List[schemas.ProviderBillingRow])
def list_provider_billing(
    cycle_month: date | None = Query(None),
    month: int | None = Query(None, ge=1, le=12),
    year: int | None = Query(None, ge=2000),
    db: Session = Depends(get_db),
    _: models.User = Depends(_require_admin),
):
    logger.info(
        "admin billing list cycle_month=%s month=%s year=%s",
        cycle_month,
        month,
        year,
    )
    resolved_month = _resolve_cycle_month(cycle_month, month, year)
    return crud.list_provider_billing_rows(db, resolved_month)


@router.post(
    "/billing/{account_number}/mark-paid",
    response_model=schemas.BillingCycleStatusOut,
)
def mark_billing_cycle_paid(
    account_number: str,
    payload: schemas.BillingCycleMarkPaidIn = Body(...),
    db: Session = Depends(get_db),
    _: models.User = Depends(_require_admin),
):
    logger.info(
        "admin billing mark-paid cycle_month=%s account=%s",
        payload.cycle_month,
        account_number,
    )
    row = (
        db.query(models.Provider, models.User)
        .join(models.User, models.Provider.user_id == models.User.id)
        .filter(models.Provider.account_number == account_number)
        .first()
    )

    if not row:
        raise HTTPException(status_code=404, detail="Provider not found")

    provider, user = row
    cycle_month = payload.cycle_month or crud.current_billing_cycle_month()
    billing_cycle = crud.mark_billing_cycle_paid(
        db,
        account_number=provider.account_number,
        cycle_month=cycle_month,
        provider_user=user,
        send_email=send_billing_paid_email,
    )

    return {
        "account_number": provider.account_number,
        "cycle_month": billing_cycle.cycle_month,
        "is_paid": billing_cycle.is_paid,
        "paid_at": billing_cycle.paid_at,
    }


@router.post(
    "/billing/mark-all-paid",
    response_model=schemas.BillingCycleMarkAllPaidOut,
)
def mark_all_billing_cycles_paid(
    payload: schemas.BillingCycleMarkAllPaidIn,
    db: Session = Depends(get_db),
    _: models.User = Depends(_require_admin),
):
    logger.info("admin billing mark-all-paid cycle_month=%s", payload.cycle_month)
    rows = (
        db.query(models.Provider, models.User)
        .join(models.User, models.Provider.user_id == models.User.id)
        .filter(models.Provider.account_number.isnot(None))
        .all()
    )
    account_numbers = [provider.account_number for provider, _user in rows if provider.account_number]
    crud.ensure_billing_cycles_for_accounts(db, account_numbers, payload.cycle_month)

    updated_count = 0
    for provider, user in rows:
        account_number = provider.account_number
        if not account_number:
            continue
        try:
            billing_cycle = crud.get_or_create_billing_cycle(
                db, account_number, payload.cycle_month
            )
            if not billing_cycle or billing_cycle.is_paid:
                continue
            crud.mark_billing_cycle_paid(
                db,
                account_number=account_number,
                cycle_month=payload.cycle_month,
                provider_user=user,
                send_email=send_billing_paid_email,
            )
            updated_count += 1
        except Exception:
            logger.exception(
                "Failed to mark billing cycle paid for account=%s",
                account_number,
            )

    return {
        "cycle_month": payload.cycle_month,
        "updated_count": updated_count,
    }


@router.put(
    "/billing/{provider_id}/status",
    response_model=schemas.ProviderBillingRow,
)
def update_provider_billing_status(
    provider_id: int,
    payload: schemas.BillingStatusUpdate,
    db: Session = Depends(get_db),
    _: models.User = Depends(_require_admin),
):
    provider = (
        db.query(models.Provider)
        .filter(models.Provider.id == provider_id)
        .first()
    )

    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")

    crud.set_provider_bills_paid_state(db, provider_id, payload.is_paid)
    summary = crud.get_provider_billing_row(db, provider_id)

    if not summary:
        raise HTTPException(status_code=404, detail="Provider not found")

    return summary


@router.put(
    "/billing/{provider_id}/lock",
    response_model=schemas.ProviderBillingRow,
)
def update_provider_lock_state(
    provider_id: int,
    payload: schemas.ProviderLockUpdate,
    db: Session = Depends(get_db),
    _: models.User = Depends(_require_admin),
):
    provider = (
        db.query(models.Provider)
        .filter(models.Provider.id == provider_id)
        .first()
    )

    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")

    crud.set_provider_lock_state(db, provider_id, payload.is_locked)
    summary = crud.get_provider_billing_row(db, provider_id)

    if not summary:
        raise HTTPException(status_code=404, detail="Provider not found")

    return summary
