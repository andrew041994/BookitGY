from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import crud, schemas, models
from app.utils.email import send_billing_paid_email
from app.database import get_db
from app.security import get_current_user_from_header

router = APIRouter(prefix="/admin", tags=["admin"])


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

    user = crud.set_user_suspension(db, provider.user_id, payload.is_suspended)
    if not user:
        raise HTTPException(
            status_code=404,
            detail="User not found for provider account number",
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

    credit = crud.create_bill_credit(db, provider.id, payload.credit_gyd)
    balance = crud.get_provider_credit_balance(db, provider.id)

    return {
        "provider_id": provider.id,
        "account_number": provider.account_number,
        "credit_applied_gyd": float(credit.amount_gyd or 0.0),
        "total_credit_balance_gyd": float(balance or 0.0),
    }


@router.get("/billing", response_model=List[schemas.ProviderBillingRow])
def list_provider_billing(
    db: Session = Depends(get_db),
    _: models.User = Depends(_require_admin),
):
    return crud.list_provider_billing_rows(db)


@router.post(
    "/billing/{account_number}/mark-paid",
    response_model=schemas.BillingCycleStatusOut,
)
def mark_billing_cycle_paid(
    account_number: str,
    db: Session = Depends(get_db),
    _: models.User = Depends(_require_admin),
):
    row = (
        db.query(models.Provider, models.User)
        .join(models.User, models.Provider.user_id == models.User.id)
        .filter(models.Provider.account_number == account_number)
        .first()
    )

    if not row:
        raise HTTPException(status_code=404, detail="Provider not found")

    provider, user = row
    cycle_month = crud.current_billing_cycle_month()
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
