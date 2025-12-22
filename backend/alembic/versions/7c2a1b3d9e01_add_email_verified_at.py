"""
Add email_verified_at to users.

Revision ID: 7c2a1b3d9e01
Revises: cd4fe1b167eb
Create Date: 2025-01-01 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision: str = "7c2a1b3d9e01"
down_revision: Union[str, None] = "cd4fe1b167eb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("email_verified_at", sa.DateTime(), nullable=True),
    )

    connection = op.get_bind()
    connection.execute(
        text(
            "UPDATE users SET email_verified_at = created_at "
            "WHERE is_email_verified = TRUE AND email_verified_at IS NULL"
        )
    )


def downgrade() -> None:
    op.drop_column("users", "email_verified_at")
