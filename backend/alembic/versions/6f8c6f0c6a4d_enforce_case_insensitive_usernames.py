"""Enforce case-insensitive usernames.

Revision ID: 6f8c6f0c6a4d
Revises: 3e5cc4d8c81c
Create Date: 2025-02-14 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision: str = "6f8c6f0c6a4d"
down_revision: Union[str, None] = "3e5cc4d8c81c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_users_username")

    connection = op.get_bind()
    connection.execute(
        text("UPDATE users SET username = LOWER(username) WHERE username IS NOT NULL")
    )

    duplicates = connection.execute(
        text(
            """
            SELECT username AS normalized, array_agg(id ORDER BY id) AS ids
            FROM users
            WHERE username IS NOT NULL
            GROUP BY username
            HAVING COUNT(*) > 1
            """
        )
    ).fetchall()

    for row in duplicates:
        ids = list(row.ids or [])
        for dup_id in ids[1:]:
            connection.execute(
                text("UPDATE users SET username = :u WHERE id = :id"),
                {"u": f"{row.normalized}-{dup_id}", "id": dup_id},
            )

    connection.execute(
        text("UPDATE users SET username = LOWER(username) WHERE username IS NOT NULL")
    )

    with op.get_context().autocommit_block():
        op.execute(
            "CREATE UNIQUE INDEX CONCURRENTLY users_username_lower_unique "
            "ON users (LOWER(username))"
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS users_username_lower_unique")

    with op.get_context().autocommit_block():
        op.execute(
            "CREATE UNIQUE INDEX CONCURRENTLY ix_users_username ON users (username)"
        )
