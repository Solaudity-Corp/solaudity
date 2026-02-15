"""merge user and audit branches

Revision ID: 7411a65eeb96
Revises: 48da3ce1f759, 2498d71abf60
Create Date: 2026-02-15 01:19:57.465398

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = '7411a65eeb96'
down_revision: Union[str, Sequence[str], None] = ('48da3ce1f759', '2498d71abf60')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
