CREATE TABLE orders (
  id         INTEGER PRIMARY KEY,
  customer   TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending'
);
