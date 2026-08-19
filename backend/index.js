const express = require('express');
const path = require('node:path');
const { db } = require('./db');
const { fetchAndStore, generateForecasts, resolveForecasts, SOURCES, fngClassification } = require('./pipeline');
const store = require('./store');

const app = express();
app.use(express.json());

// CORS: разрешаем запросы с dev-сервера Vite (http://localhost:5173).
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Ручное обновление: fetch источников → генерация прогнозов → сверка истёкших.
app.post('/api/refresh', async (req, res) => {
  try {
    const fetchRes = await fetchAndStore();
    const created = generateForecasts();
    const resolved = resolveForecasts();
    res.json({ fetch: fetchRes, forecasts_created: created, resolved });
  } catch (e) {
    console.error('refresh error:', e);
    res.status(502).json({ error: e.message });
  }
});

// Список монет с текущими метриками и последним прогнозом (левая панель).
app.get('/api/coins', (req, res) => {
  const coins = store.listCoins();
  const snapshot = store.todayMetricsSnapshot();
  const forecasts = store.listForecasts(30);
  const latestByCoin = {};
  for (const f of forecasts) {
    if (!latestByCoin[f.coin_id]) latestByCoin[f.coin_id] = f;
  }
  const out = coins.map((c) => {
    const m = snapshot[c.id] || {};
    const f = latestByCoin[c.id];
    return {
      id: c.id,
      name: c.name,
      symbol: c.symbol,
      image: c.image,
      price: m.price,
      change_24h_pct: m.change_24h_pct,
      volume_24h: m.volume_24h,
      market_cap: m.market_cap,
      volatility_7d: m.volatility_7d,
      volume_median_7d: m.volume_median_7d,
      forecast: f ? { direction: f.direction, confidence: f.confidence, score: f.score, status: f.status, created_at: f.created_at, expires_at: f.expires_at, risk: f.risk, actual_pct: null } : null,
    };
  });
  res.json(out);
});

// Карточка прогноза по монете: входные данные, события, результат сверки.
app.get('/api/forecast/:coinId', (req, res) => {
  const f = store.latestForecastFor(req.params.coinId);
  if (!f) return res.status(404).json({ error: 'no forecast' });
  const outcome = db.prepare('SELECT * FROM outcomes WHERE forecast_id = ? ORDER BY id DESC LIMIT 1').get(f.id);
  res.json({
    ...f,
    inputs: JSON.parse(f.inputs_json),
    events: JSON.parse(f.events_json),
    outcome: outcome || null,
  });
});

// История прогнозов со статусами и результатами сверки.
app.get('/api/forecasts', (req, res) => {
  const rows = store.listForecasts(50);
  const outcomes = store.getOutcomes();
  const byFid = Object.fromEntries(outcomes.map((o) => [o.forecast_id, o]));
  res.json(
    rows.map((f) => ({
      id: f.id,
      coin_id: f.coin_id,
      direction: f.direction,
      confidence: f.confidence,
      score: f.score,
      status: f.status,
      created_at: f.created_at,
      expires_at: f.expires_at,
      outcome: byFid[f.id] || null,
    }))
  );
});

// Метрики монеты по времени (для графиков).
app.get('/api/metrics/:coinId', (req, res) => {
  const rows = store.getAllMetrics(req.params.coinId);
  res.json(rows);
});

// Справочник источников данных.
app.get('/api/sources', (req, res) => {
  res.json(db.prepare('SELECT * FROM sources ORDER BY id').all());
});

// Последние сырые записи источников.
app.get('/api/raw', (req, res) => {
  res.json(store.getRaw(15));
});

// История обновлений (fetch / forecast / resolve).
app.get('/api/history', (req, res) => {
  res.json(store.getHistory(20));
});

// Сводка для дашборда: Fear & Greed + статистика точности прогнозов.
app.get('/api/dashboard', (req, res) => {
  const snapshot = store.todayMetricsSnapshot();
  const fng = snapshot.market?.fng_value ?? null;
  const outcomes = store.getOutcomes();
  const total = outcomes.length;
  const hit = outcomes.filter((o) => o.status === 'hit').length;
  const miss = outcomes.filter((o) => o.status === 'miss').length;
  const expired = outcomes.filter((o) => o.status === 'expired').length;
  const accuracy = total ? Math.round((hit / total) * 100) : null;
  res.json({
    fng: fng ? { value: fng, classification: fngClassification(fng) } : null,
    accuracy: { total, hit, miss, expired, accuracy },
    sources: SOURCES.map((s) => s.id),
  });
});

// Раздача собранного фронтенда (frontend/dist) и SPA-fallback на index.html.
const clientDist = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(clientDist, 'index.html'), (err) => { if (err) next(); });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`));

module.exports = app;