"""
Add username and email verification fields.

Revision ID: 3e5cc4d8c81c
Revises: cb4bbe4e0608
Create Date: 2024-07-11 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision: str = '3e5cc4d8c81c'
down_revision: Union[str, None] = 'cb4bbe4e0608'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('username', sa.String(), nullable=True))
    op.add_column(
        'users',
        sa.Column('is_email_verified', sa.Boolean(), server_default='0', nullable=True),
    )

    connection = op.get_bind()
    users = connection.execute(text("SELECT id, email FROM users")).fetchall()

    for row in users:
        base = ((row.email or '').split('@')[0] or 'user').strip().lower() or 'user'
        candidate = base
        suffix = 1

        while connection.execute(
            text("SELECT 1 FROM users WHERE username = :u"), {"u": candidate}
        ).fetchone():
            candidate = f"{base}{suffix}"
            suffix += 1

        connection.execute(
            text(
                "UPDATE users SET username = :u, is_email_verified = TRUE "
                "WHERE id = :id"
            ),
            {"u": candidate, "id": row.id},
        )

    op.create_index(op.f('ix_users_username'), 'users', ['username'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_users_username'), table_name='users')
    op.drop_column('users', 'is_email_verified')
    op.drop_column('users', 'username')
