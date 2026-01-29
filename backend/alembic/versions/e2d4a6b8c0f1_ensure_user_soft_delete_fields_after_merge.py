"""ensure user soft delete fields after merge

Revision ID: e2d4a6b8c0f1
Revises: c816011eee02
Create Date: 2025-02-16 00:00:01.000000
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "e2d4a6b8c0f1"
down_revision = "c816011eee02"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        ALTER TABLE users
            ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;
        """
    )
    op.execute(
        """
        ALTER TABLE users
            ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
        """
    )
    op.execute(
        """
        ALTER TABLE users
            ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
        """
    )
    op.execute(
        """
        ALTER TABLE users
            ADD COLUMN IF NOT EXISTS deleted_email_hash TEXT NULL;
        """
    )
    op.execute(
        """
        ALTER TABLE users
            ADD COLUMN IF NOT EXISTS deleted_phone_hash TEXT NULL;
        """
    )


def downgrade():
    op.execute(
        """
        ALTER TABLE users
            DROP COLUMN IF EXISTS deleted_phone_hash;
        """
    )
    op.execute(
        """
        ALTER TABLE users
            DROP COLUMN IF EXISTS deleted_email_hash;
        """
    )
    op.execute(
        """
        ALTER TABLE users
            DROP COLUMN IF EXISTS token_version;
        """
    )
    op.execute(
        """
        ALTER TABLE users
            DROP COLUMN IF EXISTS is_deleted;
        """
    )
    op.execute(
        """
        ALTER TABLE users
            DROP COLUMN IF EXISTS deleted_at;
        """
    )
