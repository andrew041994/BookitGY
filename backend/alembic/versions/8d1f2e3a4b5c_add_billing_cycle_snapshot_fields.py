"""add billing cycle snapshot fields

Revision ID: 8d1f2e3a4b5c
Revises: b513cd036ac7
Create Date: 2026-02-18 00:00:00.000000
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "8d1f2e3a4b5c"
down_revision = "b513cd036ac7"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        ALTER TABLE billing_cycles
        ADD COLUMN IF NOT EXISTS credits_applied_gyd NUMERIC(10, 2) NOT NULL DEFAULT 0;
        """
    )
    op.execute(
        """
        ALTER TABLE billing_cycles
        ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ NULL;
        """
    )


def downgrade():
    op.execute(
        """
        ALTER TABLE billing_cycles
        DROP COLUMN IF EXISTS finalized_at;
        """
    )
    op.execute(
        """
        ALTER TABLE billing_cycles
        DROP COLUMN IF EXISTS credits_applied_gyd;
        """
    )
