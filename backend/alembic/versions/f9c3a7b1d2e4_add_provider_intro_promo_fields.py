"""add provider intro promo fields

Revision ID: f9c3a7b1d2e4
Revises: 1f2c3d4e5a6b, 2a6b7c8d9e0f, 4b7d9e2a1c3f, 7a1c9b4d2e6f, 9d2e4f6a8b1c
Create Date: 2026-03-12 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f9c3a7b1d2e4"
down_revision: Union[str, Sequence[str], None] = (
    "1f2c3d4e5a6b",
    "2a6b7c8d9e0f",
    "4b7d9e2a1c3f",
    "7a1c9b4d2e6f",
    "9d2e4f6a8b1c",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("providers", sa.Column("created_at", sa.DateTime(), nullable=True))
    op.add_column(
        "providers",
        sa.Column(
            "promo_eligible",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column("providers", sa.Column("promo_started_at", sa.DateTime(), nullable=True))
    op.add_column("providers", sa.Column("promo_ends_at", sa.DateTime(), nullable=True))
    op.add_column(
        "providers",
        sa.Column(
            "default_platform_fee_pct",
            sa.Numeric(5, 2),
            nullable=False,
            server_default=sa.text("10.00"),
        ),
    )

    bind = op.get_bind()
    dialect = bind.dialect.name

    op.execute(
        """
        UPDATE providers p
        SET created_at = COALESCE(
            (SELECT u.created_at FROM users u WHERE u.id = p.user_id),
            CURRENT_TIMESTAMP
        )
        WHERE p.created_at IS NULL
        """
    )

    if dialect == "postgresql":
        op.execute(
            """
            WITH ranked AS (
                SELECT p.id, p.created_at,
                       ROW_NUMBER() OVER (ORDER BY p.created_at ASC, p.id ASC) AS rn
                FROM providers p
                WHERE p.id > 6
            )
            UPDATE providers p
            SET promo_eligible = CASE WHEN ranked.rn <= 100 THEN TRUE ELSE FALSE END,
                promo_started_at = CASE WHEN ranked.rn <= 100 THEN p.created_at ELSE NULL END,
                promo_ends_at = CASE WHEN ranked.rn <= 100 THEN p.created_at + interval '3 months' ELSE NULL END,
                default_platform_fee_pct = 10.00
            FROM ranked
            WHERE p.id = ranked.id
            """
        )
    else:
        op.execute(
            """
            WITH ranked AS (
                SELECT p.id, p.created_at,
                       ROW_NUMBER() OVER (ORDER BY p.created_at ASC, p.id ASC) AS rn
                FROM providers p
                WHERE p.id > 6
            )
            UPDATE providers
            SET promo_eligible = CASE WHEN ranked.rn <= 100 THEN 1 ELSE 0 END,
                promo_started_at = CASE WHEN ranked.rn <= 100 THEN providers.created_at ELSE NULL END,
                promo_ends_at = CASE WHEN ranked.rn <= 100 THEN datetime(providers.created_at, '+3 months') ELSE NULL END,
                default_platform_fee_pct = 10.00
            FROM ranked
            WHERE providers.id = ranked.id
            """
        )

    op.execute(
        """
        UPDATE providers
        SET promo_eligible = false,
            promo_started_at = NULL,
            promo_ends_at = NULL,
            default_platform_fee_pct = 10.00
        WHERE id <= 6
        """
    )

    op.alter_column("providers", "created_at", nullable=False)


def downgrade() -> None:
    op.drop_column("providers", "default_platform_fee_pct")
    op.drop_column("providers", "promo_ends_at")
    op.drop_column("providers", "promo_started_at")
    op.drop_column("providers", "promo_eligible")
    op.drop_column("providers", "created_at")
