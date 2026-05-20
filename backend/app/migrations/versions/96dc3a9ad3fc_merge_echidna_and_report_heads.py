"""merge echidna and report heads

Revision ID: 96dc3a9ad3fc
Revises: 90ae27907782, a8f3e1b2c9d4
Create Date: 2026-05-20 17:39:21.370079

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = '96dc3a9ad3fc'
down_revision: Union[str, Sequence[str], None] = ('90ae27907782', 'a8f3e1b2c9d4')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
