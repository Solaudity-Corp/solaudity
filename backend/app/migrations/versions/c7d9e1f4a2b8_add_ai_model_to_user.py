"""add ai model to user

Revision ID: c7d9e1f4a2b8
Revises: 96dc3a9ad3fc
Create Date: 2026-07-02 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = 'c7d9e1f4a2b8'
down_revision: Union[str, Sequence[str], None] = '96dc3a9ad3fc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('user', schema=None) as batch_op:
        batch_op.add_column(sa.Column('ai_model', sqlmodel.sql.sqltypes.AutoString(length=120), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('user', schema=None) as batch_op:
        batch_op.drop_column('ai_model')
