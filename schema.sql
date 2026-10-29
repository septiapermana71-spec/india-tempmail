PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS inboxes (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 address TEXT NOT NULL UNIQUE,
 token_hash TEXT NOT NULL UNIQUE,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inboxes_address_expiry ON inboxes(address,expires_at);
CREATE TABLE IF NOT EXISTS messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 inbox_id INTEGER NOT NULL,
 sender TEXT NOT NULL,
 subject TEXT NOT NULL,
 body_text TEXT NOT NULL,
 preview TEXT NOT NULL,
 otp TEXT NOT NULL DEFAULT '',
 received_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 FOREIGN KEY(inbox_id) REFERENCES inboxes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_messages_inbox_expiry ON messages(inbox_id,expires_at);
CREATE TABLE IF NOT EXISTS create_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 ip_hash TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_create_events_ip_time ON create_events(ip_hash,created_at);
