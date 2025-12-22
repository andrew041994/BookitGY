"""merge heads

Revision ID: cd4fe1b167eb
Revises: 6f8c6f0c6a4d, b5c2d8a7f1a2
Create Date: 2025-12-21 21:57:30.178505

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'cd4fe1b167eb'
down_revision: Union[str, None] = ('6f8c6f0c6a4d', 'b5c2d8a7f1a2')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
