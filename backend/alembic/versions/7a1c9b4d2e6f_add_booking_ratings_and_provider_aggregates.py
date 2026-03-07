"""add booking ratings and provider aggregates

Revision ID: 7a1c9b4d2e6f
Revises: 4f3c2b1a9d8e
Create Date: 2026-03-07 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "7a1c9b4d2e6f"
down_revision = "4f3c2b1a9d8e"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("providers", sa.Column("avg_rating", sa.Float(), nullable=True))
    op.add_column(
        "providers",
        sa.Column("rating_count", sa.Integer(), nullable=False, server_default="0"),
    )

    op.create_table(
        "booking_ratings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("booking_id", sa.Integer(), nullable=False),
        sa.Column("provider_id", sa.Integer(), nullable=False),
        sa.Column("client_id", sa.Integer(), nullable=False),
        sa.Column("stars", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["booking_id"], ["bookings.id"]),
        sa.ForeignKeyConstraint(["provider_id"], ["providers.id"]),
        sa.ForeignKeyConstraint(["client_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("booking_id", name="uq_booking_ratings_booking_id"),
        sa.CheckConstraint("stars >= 1 AND stars <= 5", name="ck_booking_ratings_stars_range"),
    )
    op.create_index(op.f("ix_booking_ratings_id"), "booking_ratings", ["id"], unique=False)
    op.create_index(op.f("ix_booking_ratings_booking_id"), "booking_ratings", ["booking_id"], unique=False)
    op.create_index(op.f("ix_booking_ratings_provider_id"), "booking_ratings", ["provider_id"], unique=False)
    op.create_index(op.f("ix_booking_ratings_client_id"), "booking_ratings", ["client_id"], unique=False)

    op.alter_column("providers", "rating_count", server_default=None)


def downgrade():
    op.drop_index(op.f("ix_booking_ratings_client_id"), table_name="booking_ratings")
    op.drop_index(op.f("ix_booking_ratings_provider_id"), table_name="booking_ratings")
    op.drop_index(op.f("ix_booking_ratings_booking_id"), table_name="booking_ratings")
    op.drop_index(op.f("ix_booking_ratings_id"), table_name="booking_ratings")
    op.drop_table("booking_ratings")

    op.drop_column("providers", "rating_count")
    op.drop_column("providers", "avg_rating")
