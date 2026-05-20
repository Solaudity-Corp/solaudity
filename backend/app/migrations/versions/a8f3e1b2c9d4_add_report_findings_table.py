"""add report findings table

Revision ID: a8f3e1b2c9d4
Revises: f551a15097c3
Create Date: 2026-05-20 20:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a8f3e1b2c9d4'
down_revision: Union[str, Sequence[str], None] = 'f551a15097c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'report_findings',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('audit_id', sa.Uuid(), nullable=False),
        sa.Column('order', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('title', sa.Text(), nullable=False, server_default=''),
        sa.Column('severity', sa.String(32), nullable=False, server_default=sa.text("'High'")),
        sa.Column('description', sa.Text(), nullable=False, server_default=''),
        sa.Column('scope', sa.Text(), nullable=False, server_default=''),
        sa.Column('proof_of_concept', sa.Text(), nullable=False, server_default=''),
        sa.Column('recommendation', sa.Text(), nullable=False, server_default=''),
        sa.Column('status', sa.String(32), nullable=False, server_default=sa.text("'Open'")),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.ForeignKeyConstraint(['audit_id'], ['audits.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_report_findings_audit_id', 'report_findings', ['audit_id'])


def downgrade() -> None:
    op.drop_index('ix_report_findings_audit_id', table_name='report_findings')
    op.drop_table('report_findings')
