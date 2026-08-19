const { db } = require('./db');

// Текущее время в ISO-формате — единый формат меток времени для всех таблиц.
function now() { return new Date().toISOString(); }

// Добавляет или обновляет источник данных в справочнике sources.
function upsertSource(source) {
  db.prepare(`
    INSERT INTO sources (id, name, kind, url, description, enabled)
    VALUES (?, ?, ?, ?, ?, 1)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, url=excluded.url, description=excluded.description
  `).run(source.id, source.name, source.kind, source.url || null, source.description || null);
}

// Сохраняет сырой ответ источника (JSON) в raw_records.
// Повторная запись с той же меткой времени игнорируется (UNIQUE).
function saveRaw(sourceId, payload) {
  db.prepare(`
    INSERT INTO raw_records (source_id, fetched_at, payload) VALUES (?, ?, ?)
    ON CONFLICT(source_id, fetched_at) DO NOTHING
  `).run(sourceId, now(), JSON.stringify(payload));
}

// Сохраняет нормализованный показатель (цена, объём, волатильность и т.д.) в metrics.
function saveMetric(coinId, metric, value, ts, sourceId) {
  db.prepare(`
    INSERT INTO metrics (coin_id, metric, value, ts, source_id) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(coin_id, metric, ts) DO UPDATE SET value=excluded.value
  `).run(coinId, metric, value, ts, sourceId || null);
}

// Сохраняет событие/аргумент (новость, настроение) с направлением и весом.
function saveEvent(event) {
  db.prepare(`
    INSERT INTO events (coin_id, title, category, direction, weight, source_id, detail, ts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.coin_id || 'market',
    event.title,
    event.category,
    event.direction || 'neutral',
    event.weight || 0,
    event.source_id || 'fng',
    event.detail || null,
    event.ts || now()
  );
}

// Возвращает снимок последних значений всех метрик: { coin_id: { metric: value } }.
// Используется как единый источник входных данных для расчёта прогнозов.
function todayMetricsSnapshot() {
  const rows = db.prepare(`
    SELECT coin_id, metric, value, ts FROM metrics m
    WHERE ts = (SELECT MAX(ts) FROM metrics m2 WHERE m2.coin_id = m.coin_id AND m2.metric = m.metric)
  `).all();
  const map = {};
  for (const r of rows) {
    map[r.coin_id] = map[r.coin_id] || {};
    map[r.coin_id][r.metric] = r.value;
  }
  return map;
}

// Сохраняет прогноз. inputs/events сериализуются в JSON-колонки для воспроизводимости.
function saveForecast(f) {
  const res = db.prepare(`
    INSERT INTO forecasts (coin_id, name, symbol, horizon_hours, direction, confidence, score, risk, created_at, expires_at, inputs_json, events_json, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    f.coin_id, f.name || null, f.symbol || null, f.horizon_hours, f.direction, f.confidence, f.score, f.risk,
    f.created_at, f.expires_at, JSON.stringify(f.inputs), JSON.stringify(f.events)
  );
  return Number(res.lastInsertRowid);
}

// Последний прогноз по монете (для проверки, не пора ли строить новый).
function latestForecastFor(coinId) {
  return db.prepare(`
    SELECT * FROM forecasts WHERE coin_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(coinId);
}

// Все прогнозы со статусом pending (ожидают сверки с фактической ценой).
function pendingForecasts() {
  return db.prepare(`SELECT * FROM forecasts WHERE status = 'pending' ORDER BY created_at DESC`).all();
}

// Фиксирует результат сверки прогноза с фактической ценой и обновляет статус прогноза.
function markOutcome(forecastId, actualPct, status) {
  db.prepare(`INSERT INTO outcomes (forecast_id, actual_pct, resolved_at, status) VALUES (?, ?, ?, ?)`)
    .run(forecastId, actualPct, now(), status);
  db.prepare(`UPDATE forecasts SET status = ? WHERE id = ?`).run(status, forecastId);
}

// Пишет запись в историю обновлений (fetch / forecast / resolve).
function logUpdate(kind, detail) {
  db.prepare(`INSERT INTO update_history (run_at, kind, detail) VALUES (?, ?, ?)`)
    .run(now(), kind, JSON.stringify(detail));
}

// Последние записи истории обновлений.
function getHistory(limit = 20) {
  return db.prepare(`SELECT * FROM update_history ORDER BY id DESC LIMIT ?`).all(limit);
}

// Последние сырые записи источников.
function getRaw(limit = 20) {
  return db.prepare(`SELECT * FROM raw_records ORDER BY id DESC LIMIT ?`).all(limit);
}

// Все метрики монеты по убыванию времени (для графиков).
function getAllMetrics(coinId) {
  return db.prepare(`SELECT * FROM metrics WHERE coin_id = ? ORDER BY ts DESC LIMIT 500`).all(coinId);
}

// Добавляет или обновляет монету в справочнике coins.
function upsertCoin(coin) {
  db.prepare(`
    INSERT INTO coins (id, name, symbol, image) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, symbol=excluded.symbol, image=excluded.image
  `).run(coin.id, coin.name, coin.symbol, coin.image || null);
}

// Список всех монет (для левой панели интерфейса).
function listCoins() {
  return db.prepare(`SELECT * FROM coins ORDER BY name`).all();
}

// Метаданные монеты по id.
function coinMeta(coinId) {
  return db.prepare(`SELECT * FROM coins WHERE id = ?`).get(coinId);
}

// Последние события (новости/настроение) — используются как аргументы прогноза.
function latestEvents(limit = 30) {
  return db.prepare(`SELECT * FROM events ORDER BY id DESC LIMIT ?`).all(limit);
}

// Последние прогнозы по всем монетам.
function listForecasts(limit = 20) {
  return db.prepare(`SELECT * FROM forecasts ORDER BY created_at DESC LIMIT ?`).all(limit);
}

// Все результаты сверки прогнозов (для статистики точности).
function getOutcomes() {
  return db.prepare(`SELECT * FROM outcomes ORDER BY resolved_at DESC`).all();
}

module.exports = {
  upsertSource, saveRaw, saveMetric, saveEvent,
  todayMetricsSnapshot,
  saveForecast,
  latestForecastFor,
  pendingForecasts,
  markOutcome,
  logUpdate,
  getHistory,
  getRaw,
  upsertCoin,
  listCoins,
  coinMeta,
  latestEvents,
  listForecasts,
  getOutcomes,
  getAllMetrics,
};