"""add booking cancellation actor fields

Revision ID: d1f7b0a5c9a1
Revises: 6b3dbb1f6c32
Create Date: 2025-02-16 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "d1f7b0a5c9a1"
down_revision = "6b3dbb1f6c32"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("bookings", sa.Column("canceled_by_user_id", sa.Integer(), nullable=True))
    op.add_column("bookings", sa.Column("canceled_by_role", sa.String(), nullable=True))
    op.create_foreign_key(
        "fk_bookings_canceled_by_user_id_users",
        "bookings",
        "users",
        ["canceled_by_user_id"],
        ["id"],
    )


def downgrade():
    op.drop_constraint("fk_bookings_canceled_by_user_id_users", "bookings", type_="foreignkey")
    op.drop_column("bookings", "canceled_by_role")
    op.drop_column("bookings", "canceled_by_user_id")
