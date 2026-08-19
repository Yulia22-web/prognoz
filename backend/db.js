const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

// Данные хранятся в data/ рядом с проектом; папка создаётся при первом запуске.
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'forecaster.db');
const db = new DatabaseSync(DB_PATH);

// Схема БД: справочники (coins, sources), сырые данные (raw_records),
// нормализованные показатели (metrics), события (events), прогнозы (forecasts),
// результаты сверки (outcomes) и история обновлений (update_history).
db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS coins (
    id     TEXT PRIMARY KEY,
    name   TEXT NOT NULL,
    symbol TEXT NOT NULL,
    image  TEXT
  );

  CREATE TABLE IF NOT EXISTS sources (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    kind       TEXT NOT NULL,
    url        TEXT,
    description TEXT,
    enabled    INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS raw_records (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id  TEXT NOT NULL REFERENCES sources(id),
    fetched_at TEXT NOT NULL,
    payload    TEXT NOT NULL,
    UNIQUE(source_id, fetched_at)
  );

  CREATE TABLE IF NOT EXISTS metrics (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    coin_id    TEXT NOT NULL,
    metric     TEXT NOT NULL,
    value      REAL NOT NULL,
    ts         TEXT NOT NULL,
    source_id  TEXT REFERENCES sources(id),
    UNIQUE(coin_id, metric, ts)
  );

  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    coin_id    TEXT NOT NULL,
    title      TEXT NOT NULL,
    category   TEXT NOT NULL,
    direction  TEXT NOT NULL,
    weight     REAL NOT NULL,
    source_id  TEXT REFERENCES sources(id),
    detail     TEXT,
    ts         TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS forecasts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    coin_id       TEXT NOT NULL,
    name          TEXT,
    symbol        TEXT,
    horizon_hours INTEGER NOT NULL,
    direction     TEXT NOT NULL,
    confidence    REAL NOT NULL,
    score         REAL NOT NULL,
    risk          TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    expires_at    TEXT NOT NULL,
    inputs_json   TEXT NOT NULL,
    events_json   TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending'
  );

  CREATE TABLE IF NOT EXISTS outcomes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    forecast_id INTEGER NOT NULL REFERENCES forecasts(id),
    actual_pct  REAL NOT NULL,
    resolved_at TEXT NOT NULL,
    status      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS update_history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    run_at     TEXT NOT NULL,
    kind       TEXT NOT NULL,
    detail     TEXT
  );
`);

// Миграции: добавляем колонки, которых может не быть в БД, созданной до обновления.
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn('forecasts', 'name', 'name TEXT');
ensureColumn('forecasts', 'symbol', 'symbol TEXT');

module.exports = { db, DB_PATH };