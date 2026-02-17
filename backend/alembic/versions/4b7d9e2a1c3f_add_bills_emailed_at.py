"""add bills emailed_at

Revision ID: 4b7d9e2a1c3f
Revises: e2d4a6b8c0f1
Create Date: 2026-02-17 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "4b7d9e2a1c3f"
down_revision = "e2d4a6b8c0f1"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("bills", sa.Column("emailed_at", sa.DateTime(), nullable=True))


def downgrade():
    op.drop_column("bills", "emailed_at")
