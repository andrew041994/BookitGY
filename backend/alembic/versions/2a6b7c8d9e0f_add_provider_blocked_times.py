"""add provider blocked times

Revision ID: 2a6b7c8d9e0f
Revises: f2a1d9c7b4e3
Create Date: 2026-03-06 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "2a6b7c8d9e0f"
down_revision = "f2a1d9c7b4e3"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "provider_blocked_times",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("provider_id", sa.Integer(), nullable=False),
        sa.Column("start_at", sa.DateTime(), nullable=False),
        sa.Column("end_at", sa.DateTime(), nullable=False),
        sa.Column("is_all_day", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["provider_id"], ["providers.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_provider_blocked_times_id"), "provider_blocked_times", ["id"], unique=False)
    op.create_index(op.f("ix_provider_blocked_times_provider_id"), "provider_blocked_times", ["provider_id"], unique=False)
    op.create_index(op.f("ix_provider_blocked_times_start_at"), "provider_blocked_times", ["start_at"], unique=False)
    op.create_index(op.f("ix_provider_blocked_times_end_at"), "provider_blocked_times", ["end_at"], unique=False)
    op.create_index(
        "ix_provider_blocked_times_provider_start_end",
        "provider_blocked_times",
        ["provider_id", "start_at", "end_at"],
        unique=False,
    )


def downgrade():
    op.drop_index("ix_provider_blocked_times_provider_start_end", table_name="provider_blocked_times")
    op.drop_index(op.f("ix_provider_blocked_times_end_at"), table_name="provider_blocked_times")
    op.drop_index(op.f("ix_provider_blocked_times_start_at"), table_name="provider_blocked_times")
    op.drop_index(op.f("ix_provider_blocked_times_provider_id"), table_name="provider_blocked_times")
    op.drop_index(op.f("ix_provider_blocked_times_id"), table_name="provider_blocked_times")
    op.drop_table("provider_blocked_times")
