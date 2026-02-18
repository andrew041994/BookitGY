"""add bill credit consumption linkage and uniqueness

Revision ID: 9d2e4f6a8b1c
Revises: 8d1f2e3a4b5c
Create Date: 2026-02-18 00:00:01.000000
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "9d2e4f6a8b1c"
down_revision = "8d1f2e3a4b5c"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        ALTER TABLE bill_credits
        ADD COLUMN IF NOT EXISTS kind VARCHAR NULL;
        """
    )
    op.execute(
        """
        ALTER TABLE bill_credits
        ADD COLUMN IF NOT EXISTS billing_cycle_account_number VARCHAR NULL;
        """
    )
    op.execute(
        """
        ALTER TABLE bill_credits
        ADD COLUMN IF NOT EXISTS billing_cycle_month DATE NULL;
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'fk_bill_credits_billing_cycle'
            ) THEN
                ALTER TABLE bill_credits
                ADD CONSTRAINT fk_bill_credits_billing_cycle
                FOREIGN KEY (billing_cycle_account_number, billing_cycle_month)
                REFERENCES billing_cycles (account_number, cycle_month)
                ON DELETE SET NULL;
            END IF;
        END
        $$;
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_bill_credits_consumed_per_cycle
        ON bill_credits (billing_cycle_account_number, billing_cycle_month)
        WHERE kind = 'billing_credit_consumed';
        """
    )


def downgrade():
    op.execute(
        """
        DROP INDEX IF EXISTS uq_bill_credits_consumed_per_cycle;
        """
    )
    op.execute(
        """
        ALTER TABLE bill_credits
        DROP CONSTRAINT IF EXISTS fk_bill_credits_billing_cycle;
        """
    )
    op.execute(
        """
        ALTER TABLE bill_credits
        DROP COLUMN IF EXISTS billing_cycle_month;
        """
    )
    op.execute(
        """
        ALTER TABLE bill_credits
        DROP COLUMN IF EXISTS billing_cycle_account_number;
        """
    )
    op.execute(
        """
        ALTER TABLE bill_credits
        DROP COLUMN IF EXISTS kind;
        """
    )
