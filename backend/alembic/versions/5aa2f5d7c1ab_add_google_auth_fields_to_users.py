"""add google auth fields to users

Revision ID: 5aa2f5d7c1ab
Revises: 9d2e4f6a8b1c
Create Date: 2026-03-03 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "5aa2f5d7c1ab"
down_revision: Union[str, Sequence[str], None] = "9d2e4f6a8b1c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("google_sub", sa.String(), nullable=True))
    op.add_column(
        "users",
        sa.Column("auth_provider", sa.String(), nullable=False, server_default="local"),
    )
    op.create_index(op.f("ix_users_google_sub"), "users", ["google_sub"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_users_google_sub"), table_name="users")
    op.drop_column("users", "auth_provider")
    op.drop_column("users", "google_sub")
