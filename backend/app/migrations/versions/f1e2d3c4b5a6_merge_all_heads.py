"""merge all migration heads

Revision ID: f1e2d3c4b5a6
Revises: b0ff859e51dd, d1a2b3c4d5e6
Create Date: 2026-03-22 00:00:01.000000

"""
from typing import Sequence, Union

revision: str = 'f1e2d3c4b5a6'
down_revision: Union[str, Sequence[str], None] = ('b0ff859e51dd', 'd1a2b3c4d5e6')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
