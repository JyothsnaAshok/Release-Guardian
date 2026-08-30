-- Structurally restores the column, but every row's status collapses to 'pending':
-- the original 'shipped' / 'pending' / 'refunded' values dropped by the up migration
-- are gone. Schema parity and row-count parity both pass; the row-content parity
-- check (see skills/rollback-runbook-format) is what catches the loss, so this
-- fixture must be classified migration_reversible = false.
ALTER TABLE orders ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
