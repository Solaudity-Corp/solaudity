"""merge ai_provider and solparsing branches

Revision ID: d1a2b3c4d5e6
Revises: afb90b9643e5, ec1012541e69
Create Date: 2026-03-22 00:00:00.000000

"""
from typing import Sequence, Union

revision: str = 'd1a2b3c4d5e6'
down_revision: Union[str, Sequence[str], None] = ('afb90b9643e5', 'ec1012541e69')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
