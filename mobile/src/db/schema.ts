/** Every migration ever applied, in order. The database records how many it
 *  has run (user_version), so an upgrade only runs the new ones and an
 *  existing shop never loses its orders to a schema change. */
export const MIGRATIONS: string[] = [
  // 1 - the order book itself.
  `
  CREATE TABLE IF NOT EXISTS parties (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_parties_name ON parties(name);

  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'kg',
    default_rate REAL NOT NULL DEFAULT 0,
    kg_per_bag REAL NOT NULL DEFAULT 30,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_items_name ON items(name);

  CREATE TABLE IF NOT EXISTS brokers (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    commission_pct REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY NOT NULL,
    order_no TEXT NOT NULL,
    party_id TEXT NOT NULL,
    party_name TEXT NOT NULL,
    broker_id TEXT,
    broker_name TEXT,
    date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    note TEXT,
    subtotal REAL NOT NULL DEFAULT 0,
    discount REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    received REAL NOT NULL DEFAULT 0,
    balance REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (party_id) REFERENCES parties(id)
  );
  CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(date DESC);
  CREATE INDEX IF NOT EXISTS idx_orders_party ON orders(party_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_no ON orders(order_no);

  CREATE TABLE IF NOT EXISTS order_lines (
    id TEXT PRIMARY KEY NOT NULL,
    order_id TEXT NOT NULL,
    item_id TEXT,
    item_name TEXT NOT NULL,
    bags REAL,
    qty REAL NOT NULL DEFAULT 0,
    rate REAL NOT NULL DEFAULT 0,
    amount REAL NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    -- Deleting a bill has to take its lines with it, or the next export
    -- reports items belonging to an order that no longer exists.
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_lines_order ON order_lines(order_id);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT
  );
  `,
];
