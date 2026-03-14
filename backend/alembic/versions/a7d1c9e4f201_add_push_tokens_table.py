"""add push tokens table

Revision ID: a7d1c9e4f201
Revises: 25bc92f0da94, f9c3a7b1d2e4
Create Date: 2026-03-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a7d1c9e4f201"
down_revision: Union[str, Sequence[str], None] = ("25bc92f0da94", "f9c3a7b1d2e4")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "push_tokens",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("expo_push_token", sa.String(), nullable=False),
        sa.Column("platform", sa.String(), nullable=True),
        sa.Column("device_id", sa.String(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("expo_push_token", name="uq_push_tokens_expo_push_token"),
    )
    op.create_index(op.f("ix_push_tokens_id"), "push_tokens", ["id"], unique=False)
    op.create_index(op.f("ix_push_tokens_user_id"), "push_tokens", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_push_tokens_user_id"), table_name="push_tokens")
    op.drop_index(op.f("ix_push_tokens_id"), table_name="push_tokens")
    op.drop_table("push_tokens")
