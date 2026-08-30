-- Release candidate under test touches this migration.
-- It drops a column with live data and NO faithful reverse: the down migration
-- can recreate the column but cannot restore the values. Rollback Check must
-- flag this as migration_reversible = false.
ALTER TABLE orders DROP COLUMN status;
