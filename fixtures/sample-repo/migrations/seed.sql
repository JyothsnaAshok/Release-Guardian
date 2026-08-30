-- Deliberately varied, non-default status values: 'pending' is the column default,
-- so 'shipped' and 'refunded' are what expose data loss when 0003's down migration
-- recreates the column with everything set to 'pending'.
INSERT INTO orders (id, customer, total_cents, status) VALUES
  (1, 'acme',    12000, 'shipped'),
  (2, 'globex',   4500, 'pending'),
  (3, 'initech',  9900, 'refunded');
