import logging
from datetime import date
from typing import List

from fastapi import APIRouter, Body, Depends, HTTPException, Query
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

    if user.is_suspended == payload.is_suspended:
        return {"account_number": provider.account_number, "is_suspended": user.is_suspended}

    user = crud.set_user_suspension(db, provider.user_id, payload.is_suspended)

    if user and user.email:
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

    return {"account_number": provider.account_number, "is_suspended": user.is_suspended}


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
