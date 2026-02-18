"""add billing cycle snapshot fields

Revision ID: 8d1f2e3a4b5c
Revises: b513cd036ac7
Create Date: 2026-02-18 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "8d1f2e3a4b5c"
down_revision = "b513cd036ac7"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "billing_cycles",
        sa.Column(
            "credits_applied_gyd",
            sa.Numeric(precision=10, scale=2),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    op.add_column(
        "billing_cycles",
        sa.Column("finalized_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade():
    op.drop_column("billing_cycles", "finalized_at")
    op.drop_column("billing_cycles", "credits_applied_gyd")
