"""merge chat migration heads

Revision ID: 25bc92f0da94
Revises: 0c9e6d4b2a11, 2b8f8285c8d8
Create Date: 2026-03-06 03:34:37.844806

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '25bc92f0da94'
down_revision: Union[str, None] = ('0c9e6d4b2a11', '2b8f8285c8d8')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
