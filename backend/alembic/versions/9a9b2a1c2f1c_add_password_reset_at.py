"""
Add password_reset_at to users.

Revision ID: 9a9b2a1c2f1c
Revises: 3e5cc4d8c81c
Create Date: 2024-09-10 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "9a9b2a1c2f1c"
down_revision: Union[str, None] = "3e5cc4d8c81c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("password_reset_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "password_reset_at")
