"""add user soft delete fields

Revision ID: 1f2c3d4e5a6b
Revises: d1f7b0a5c9a1
Create Date: 2025-02-16 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "1f2c3d4e5a6b"
down_revision = "d1f7b0a5c9a1"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("deleted_at", sa.DateTime(), nullable=True))
    op.add_column(
        "users",
        sa.Column(
            "is_deleted",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "token_version",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    op.add_column(
        "users",
        sa.Column("deleted_email_hash", sa.Text(), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("deleted_phone_hash", sa.Text(), nullable=True),
    )


def downgrade():
    op.drop_column("users", "deleted_phone_hash")
    op.drop_column("users", "deleted_email_hash")
    op.drop_column("users", "token_version")
    op.drop_column("users", "is_deleted")
    op.drop_column("users", "deleted_at")
