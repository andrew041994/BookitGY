"""Add unique constraint for bills provider/month

Revision ID: 3f4d7c3e3b43
Revises: ('6b3dbb1f6c32', '9a9b2a1c2f1c')
Create Date: 2025-02-08 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "3f4d7c3e3b43"
down_revision: Union[str, Sequence[str], None] = ("6b3dbb1f6c32", "9a9b2a1c2f1c")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_unique_constraint(
        "uq_bills_provider_month", "bills", ["provider_id", "month"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_bills_provider_month", "bills", type_="unique")
