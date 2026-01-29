"""merge heads

Revision ID: c816011eee02
Revises: 1f2c3d4e5a6b, 3f4d7c3e3b43, 7c2a1b3d9e01
Create Date: 2026-01-28 22:04:18.597933

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c816011eee02'
down_revision: Union[str, None] = ('1f2c3d4e5a6b', '3f4d7c3e3b43', '7c2a1b3d9e01')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
