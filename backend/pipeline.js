const { fetchMarkets, fetchHistory, fetchFng, COIN_IDS } = require('./sources');
const { ingestNewsSnapshot } = require('./news');
const { buildForecast } = require('./engine');
const store = require('./store');

const HORIZON_HOURS = 24;

// Справочник источников: регистрируется в БД и показывается в интерфейсе.
const SOURCES = [
  { id: 'coingecko_markets', name: 'CoinGecko /coins/markets', kind: 'api', url: 'https://api.coingecko.com/api/v3/coins/markets', description: 'Цены, объёмы, капитализация, изменения 24ч/7д для топ-монет' },
  { id: 'coingecko_history', name: 'CoinGecko /market_chart (7d)', kind: 'api', url: 'https://api.coingecko.com/api/v3/coins/{id}/market_chart', description: 'Почасовая история цен и объёмов за 7 дней (волатильность, медиана объёма)' },
  { id: 'fng', name: 'Fear & Greed Index', kind: 'api', url: 'https://api.alternative.me/fng/', description: 'Индекс настроения рынка 0..100 (новости, соцсети, волатильность, объёмы, опросы)' },
  { id: 'news_feed', name: 'Новостные триггеры (словарь)', kind: 'local', url: null, description: 'Локальный словарь новостных категорий с тональностью' },
];

// Регистрирует все источники в справочнике sources (upsert).
async function ensureSources() {
  for (const s of SOURCES) store.upsertSource(s);
}

// Классификация значения индекса Fear & Greed в текстовую метку.
function fngClassification(value) {
  if (value == null) return 'unknown';
  if (value < 25) return 'Extreme Fear';
  if (value < 45) return 'Fear';
  if (value <= 55) return 'Neutral';
  if (value < 80) return 'Greed';
  return 'Extreme Greed';
}

// Главный цикл обновления данных:
// 1) рынок (цены/объёмы) → 2) Fear & Greed → 3) новостной фон →
// 4) история цен → 5) нормализация метрик в БД.
async function fetchAndStore() {
  await ensureSources();
  const ts = new Date().toISOString();

  const markets = await fetchMarkets();
  store.saveRaw('coingecko_markets', { fetched_at: ts, markets });
  const byId = Object.fromEntries(markets.map((m) => [m.coin_id, m]));
  for (const m of markets) store.upsertCoin({ id: m.coin_id, name: m.name, symbol: m.symbol, image: m.image });

  let fngList = [];
  try {
    fngList = await fetchFng();
    store.saveRaw('fng', { fetched_at: ts, data: fngList.slice(0, 3) });
  } catch (e) {
    console.warn('[fetch] fng failed:', e.message);
  }
  const fngVal = fngList[0]?.value ?? null;

  const newsEvents = await ingestNewsSnapshot(store);
  store.saveRaw('news_feed', { fetched_at: ts, items: newsEvents });
  for (const e of newsEvents) {
    store.saveEvent({
      coin_id: 'market',
      title: e.full,
      category: e.category,
      direction: e.sentiment > 0.1 ? 'up' : e.sentiment < -0.1 ? 'down' : 'neutral',
      weight: Math.abs(e.sentiment),
      source_id: 'news_feed',
      detail: e.label,
      ts,
    });
  }

  const historyMap = {};
  for (const coinId of COIN_IDS) {
    try {
      const h = await fetchHistory(coinId, 7);
      if (h && h.prices && h.prices.length) {
        historyMap[coinId] = h;
        store.saveRaw('coingecko_history', { fetched_at: ts, coin_id: coinId, points: h.prices.length });
      }
    } catch (e) {
      console.warn(`[fetch] history ${coinId} failed:`, e.message);
    }
  }

  for (const coinId of COIN_IDS) {
    const m = byId[coinId];
    if (!m) continue;
    store.saveMetric(coinId, 'price', m.price, ts, 'coingecko_markets');
    store.saveMetric(coinId, 'volume_24h', m.volume_24h, ts, 'coingecko_markets');
    store.saveMetric(coinId, 'market_cap', m.market_cap, ts, 'coingecko_markets');
    store.saveMetric(coinId, 'change_24h_pct', m.change_24h_pct, ts, 'coingecko_markets');
    store.saveMetric(coinId, 'change_7d_pct', m.change_7d_pct, ts, 'coingecko_markets');

    if (historyMap[coinId]?.volumes?.length) {
      store.saveMetric(coinId, 'volume_median_7d', median(historyMap[coinId].volumes.map(([, v]) => v)), ts, 'coingecko_history');
    }
    if (historyMap[coinId]?.prices?.length) {
      store.saveMetric(coinId, 'volatility_7d', hourlyVolatility(historyMap[coinId].prices), ts, 'coingecko_history');
    }
  }

  if (fngVal != null) {
    store.saveMetric('market', 'fng_value', fngVal, ts, 'fng');
    store.saveEvent({
      coin_id: 'market',
      title: `Fear & Greed: ${fngVal} (${fngClassification(fngVal)})`,
      category: 'sentiment',
      direction: fngVal < 45 ? 'up' : fngVal > 55 ? 'down' : 'neutral',
      weight: Math.abs(50 - fngVal) / 50,
      source_id: 'fng',
      detail: 'индекс страха и жадности от alternative.me',
      ts,
    });
  }

  store.logUpdate('fetch', { coins: markets.length, fng: fngVal, history: Object.keys(historyMap).length });
  return { markets: markets.length, fng: fngVal, history: Object.keys(historyMap).length };
}

// Медиана массива чисел (для объёмов за неделю).
function median(arr) {
  if (!arr || !arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Почасовая волатильность: стандартное отклонение часовых доходностей, в %.
function hourlyVolatility(prices) {
  if (!prices || prices.length < 3) return null;
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1][1] > 0) returns.push((prices[i][1] - prices[i - 1][1]) / prices[i - 1][1]);
  }
  if (!returns.length) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * 100;
}

// Строит прогнозы по всем монетам из снимка метрик в БД.
// Пропускает монеты, у которых ещё активен (не истёк) текущий прогноз.
function generateForecasts() {
  const snapshot = store.todayMetricsSnapshot();
  const hourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
  const coinEvents = store.latestEvents(200).filter((e) => e.ts >= hourAgo);
  const ts = new Date().toISOString();
  const expiresAt = new Date(Date.now() + HORIZON_HOURS * 3600 * 1000).toISOString();
  let created = 0;

  for (const coinId of COIN_IDS) {
    const m = snapshot[coinId];
    if (!m) continue;
    const meta = store.coinMeta(coinId);
    if (!meta) continue;

    const latest = store.latestForecastFor(coinId);
    if (latest && new Date(latest.expires_at) > new Date()) continue;

    const fngValue = snapshot.market?.fng_value ?? null;
    const newsEvents = coinEvents
      .filter((e) => e.coin_id === 'market')
      .map((e) => ({
        ...e,
        sentiment: e.direction === 'up' ? 0.3 : e.direction === 'down' ? -0.3 : 0,
      }));
    const metrics = {
      ...m,
      fng_value: fngValue,
      fng_classification: fngClassification(fngValue),
      newsEvents,
    };
    const coin = { ...meta, price: m.price, market_cap: m.market_cap, volume_24h: m.volume_24h, change_24h_pct: m.change_24h_pct, change_7d_pct: m.change_7d_pct };
    const f = buildForecast(coin, metrics);
    store.saveForecast({ ...f, coin_id: coinId, created_at: ts, expires_at: expiresAt });
    created++;
  }

  store.logUpdate('forecast', { created });
  return created;
}

// Сверяет истёкшие прогнозы с фактической ценой из БД:
// up → hit при росте, down → hit при падении, flat → hit при |изменение| ≤ 1%.
// Так система «понимает, что ошиблась».
function resolveForecasts() {
  const pending = store.pendingForecasts();
  const snapshot = store.todayMetricsSnapshot();
  const resolved = { hit: 0, miss: 0, expired: 0 };

  for (const f of pending) {
    if (new Date(f.expires_at) > new Date()) continue;
    const priceNow = snapshot[f.coin_id]?.price;
    if (priceNow == null) {
      store.markOutcome(f.id, null, 'expired');
      resolved.expired++;
      continue;
    }
    const inputs = JSON.parse(f.inputs_json);
    const base = inputs.price;
    if (!base) {
      store.markOutcome(f.id, null, 'expired');
      resolved.expired++;
      continue;
    }
    const actualPct = ((priceNow - base) / base) * 100;
    let hit;
    if (f.direction === 'flat') hit = Math.abs(actualPct) <= 1.0;
    else if (f.direction === 'up') hit = actualPct >= 0;
    else hit = actualPct <= 0;
    const status = hit ? 'hit' : 'miss';
    store.markOutcome(f.id, actualPct, status);
    resolved[status]++;
  }

  if (resolved.hit + resolved.miss + resolved.expired > 0) {
    store.logUpdate('resolve', resolved);
  }
  return resolved;
}

module.exports = { fetchAndStore, generateForecasts, resolveForecasts, HORIZON_HOURS, fngClassification, SOURCES };