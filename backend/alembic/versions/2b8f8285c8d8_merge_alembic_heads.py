"""merge alembic heads

Revision ID: 2b8f8285c8d8
Revises: 2a6b7c8d9e0f, 5aa2f5d7c1ab
Create Date: 2026-03-06 02:34:40.604016

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2b8f8285c8d8'
down_revision: Union[str, None] = ('2a6b7c8d9e0f', '5aa2f5d7c1ab')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
