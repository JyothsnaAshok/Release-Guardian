-- Structurally restores the column but every row's status is lost (defaults to 'pending').
-- Row/schema parity check against the pre-up snapshot will fail on the data.
ALTER TABLE orders ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
