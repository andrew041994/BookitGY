"""add oauth identities

Revision ID: a1b2c3d4e5f6
Revises: f2a1d9c7b4e3
Create Date: 2026-02-10 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "f2a1d9c7b4e3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "oauth_identities",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("provider_user_id", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider", "provider_user_id", name="uq_oauth_provider_user"),
    )
    op.create_index(op.f("ix_oauth_identities_id"), "oauth_identities", ["id"], unique=False)
    op.create_index(op.f("ix_oauth_identities_provider"), "oauth_identities", ["provider"], unique=False)
    op.create_index(op.f("ix_oauth_identities_provider_user_id"), "oauth_identities", ["provider_user_id"], unique=False)
    op.create_index(op.f("ix_oauth_identities_user_id"), "oauth_identities", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_oauth_identities_user_id"), table_name="oauth_identities")
    op.drop_index(op.f("ix_oauth_identities_provider_user_id"), table_name="oauth_identities")
    op.drop_index(op.f("ix_oauth_identities_provider"), table_name="oauth_identities")
    op.drop_index(op.f("ix_oauth_identities_id"), table_name="oauth_identities")
    op.drop_table("oauth_identities")
