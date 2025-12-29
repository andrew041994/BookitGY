"""add booking completion and cancellation timestamps

Revision ID: 6b3dbb1f6c32
Revises: cd4fe1b167eb
Create Date: 2024-06-02 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "6b3dbb1f6c32"
down_revision = "cd4fe1b167eb"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("bookings", sa.Column("completed_at", sa.DateTime(), nullable=True))
    op.add_column("bookings", sa.Column("canceled_at", sa.DateTime(), nullable=True))


def downgrade():
    op.drop_column("bookings", "canceled_at")
    op.drop_column("bookings", "completed_at")
