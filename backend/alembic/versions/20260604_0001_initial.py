"""initial backend schema

Revision ID: 20260604_0001
Revises:
Create Date: 2026-06-04
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260604_0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return _inspector().has_table(table_name)


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return any(column["name"] == column_name for column in _inspector().get_columns(table_name))


def _has_index(table_name: str, index_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return any(index["name"] == index_name for index in _inspector().get_indexes(table_name))


def _add_column_if_missing(table_name: str, column: sa.Column) -> None:
    if not _has_column(table_name, column.name):
        op.add_column(table_name, column)


def _create_index_if_missing(index_name: str, table_name: str, columns: list[str]) -> None:
    if not _has_index(table_name, index_name):
        op.create_index(index_name, table_name, columns, unique=False)


def upgrade() -> None:
    if not _has_table("webhook_events"):
        op.create_table(
            "webhook_events",
            sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
            sa.Column("session_id", sa.String(length=100), nullable=False),
            sa.Column("method", sa.String(length=10), nullable=False),
            sa.Column("headers", sa.JSON(), nullable=False),
            sa.Column("body", sa.Text(), nullable=True),
            sa.Column("query_params", sa.JSON(), nullable=True),
            sa.Column("received_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("forward_status", sa.Integer(), nullable=True),
            sa.Column("forward_response", sa.Text(), nullable=True),
            sa.Column("forward_error", sa.Text(), nullable=True),
            sa.Column("forward_failure_kind", sa.String(length=32), nullable=True),
            sa.Column("forward_delivery_status", sa.String(length=32), nullable=True),
            sa.Column("forwarded_at", sa.DateTime(), nullable=True),
            sa.Column("replay_target_event_id", sa.Integer(), nullable=True),
        )
    else:
        _add_column_if_missing("webhook_events", sa.Column("forward_failure_kind", sa.String(length=32), nullable=True))
        _add_column_if_missing("webhook_events", sa.Column("forward_delivery_status", sa.String(length=32), nullable=True))
        _add_column_if_missing("webhook_events", sa.Column("replay_target_event_id", sa.Integer(), nullable=True))

    if not _has_table("session_configs"):
        op.create_table(
            "session_configs",
            sa.Column("session_id", sa.String(length=100), primary_key=True, nullable=False),
            sa.Column("forward_url", sa.Text(), nullable=True),
            sa.Column("provider", sa.String(length=32), nullable=False, server_default="generic"),
            sa.Column("razorpay_webhook_secret", sa.Text(), nullable=True),
            sa.Column("auth_token_hash", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("updated_at", sa.DateTime(), nullable=True, server_default=sa.text("CURRENT_TIMESTAMP")),
        )
    else:
        _add_column_if_missing("session_configs", sa.Column("provider", sa.String(length=32), nullable=False, server_default="generic"))
        _add_column_if_missing("session_configs", sa.Column("razorpay_webhook_secret", sa.Text(), nullable=True))
        _add_column_if_missing("session_configs", sa.Column("auth_token_hash", sa.Text(), nullable=True))

    _create_index_if_missing("ix_webhook_events_id", "webhook_events", ["id"])
    _create_index_if_missing("ix_webhook_events_session_id", "webhook_events", ["session_id"])
    _create_index_if_missing("ix_session_configs_session_id", "session_configs", ["session_id"])
    _create_index_if_missing("idx_webhook_events_session_id_id", "webhook_events", ["session_id", "id"])

    if op.get_bind().dialect.name == "postgresql":
        op.execute(
            "CREATE INDEX IF NOT EXISTS idx_webhook_events_razorpay_event_id "
            "ON webhook_events (session_id, ((headers ->> 'x-razorpay-event-id')), id) "
            "WHERE (headers ->> 'x-razorpay-event-id') IS NOT NULL"
        )


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP INDEX IF EXISTS idx_webhook_events_razorpay_event_id")
    if _has_index("webhook_events", "idx_webhook_events_session_id_id"):
        op.drop_index("idx_webhook_events_session_id_id", table_name="webhook_events")
    if _has_index("session_configs", "ix_session_configs_session_id"):
        op.drop_index("ix_session_configs_session_id", table_name="session_configs")
    if _has_index("webhook_events", "ix_webhook_events_session_id"):
        op.drop_index("ix_webhook_events_session_id", table_name="webhook_events")
    if _has_index("webhook_events", "ix_webhook_events_id"):
        op.drop_index("ix_webhook_events_id", table_name="webhook_events")
    if _has_table("session_configs"):
        op.drop_table("session_configs")
    if _has_table("webhook_events"):
        op.drop_table("webhook_events")
