"""Initial schema - webhook_events and session_configs

Revision ID: 001_initial
Revises:
Create Date: 2026-05-07

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '001_initial'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create webhook_events table
    op.create_table(
        'webhook_events',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('session_id', sa.String(length=100), nullable=False),
        sa.Column('method', sa.String(length=10), nullable=False),
        sa.Column('headers', postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column('body', sa.Text(), nullable=True),
        sa.Column('query_params', postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('received_at', sa.DateTime(), nullable=False),
        sa.Column('forward_status', sa.Integer(), nullable=True),
        sa.Column('forward_response', sa.Text(), nullable=True),
        sa.Column('forward_error', sa.Text(), nullable=True),
        sa.Column('forwarded_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_webhook_events_id'), 'webhook_events', ['id'], unique=False)
    op.create_index(op.f('ix_webhook_events_session_id'), 'webhook_events', ['session_id'], unique=False)

    # Create session_configs table
    op.create_table(
        'session_configs',
        sa.Column('session_id', sa.String(length=100), nullable=False),
        sa.Column('forward_url', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('session_id')
    )


def downgrade() -> None:
    op.drop_table('session_configs')
    op.drop_index(op.f('ix_webhook_events_session_id'), table_name='webhook_events')
    op.drop_index(op.f('ix_webhook_events_id'), table_name='webhook_events')
    op.drop_table('webhook_events')