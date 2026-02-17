"""merge oauth + bills emailed_at heads

Revision ID: b513cd036ac7
Revises: 4b7d9e2a1c3f, a1b2c3d4e5f6
Create Date: 2026-02-17 03:28:55.285987

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b513cd036ac7'
down_revision: Union[str, None] = ('4b7d9e2a1c3f', 'a1b2c3d4e5f6')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
