// Монеты, по которым строятся прогнозы (топ-5 по капитализации).
const COIN_IDS = ['bitcoin', 'ethereum', 'solana', 'ripple', 'cardano'];
const COINGECKO = 'https://api.coingecko.com/api/v3';
const FNG_URL = 'https://api.alternative.me/fng/?limit=14';
const USER_AGENT = { 'User-Agent': 'future-forecaster/1.0', Accept: 'application/json' };

// Оборачивает промис таймаутом: если запрос не завершился за ms — отклоняем.
async function withTimeout(promise, ms = 12000) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); });
  try { return await Promise.race([promise, timeout]); } finally { clearTimeout(t); }
}

// GET с повторными попытками: до tries раз, с растущей паузой между попытками.
// Нужно из-за жёстких rate limit'ов бесплатных API.
async function fetchRetry(url, tries = 3, delayMs = 1200) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await withTimeout(fetch(url, { headers: USER_AGENT, signal: AbortSignal.timeout(6000) }), 8000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw lastErr;
}

// Текущие цены/объёмы/капитализация по всем монетам из COIN_IDS.
async function fetchMarkets() {
  const url = `${COINGECKO}/coins/markets?vs_currency=usd&ids=${COIN_IDS.join(',')}&price_change_percentage=24h%2C7d&sparkline=false`;
  const data = await fetchRetry(url);
  return data.map((m) => ({
    coin_id: m.id,
    name: m.name,
    symbol: m.symbol.toUpperCase(),
    price: m.current_price,
    market_cap: m.market_cap,
    volume_24h: m.total_volume,
    change_24h_pct: m.price_change_percentage_24h_in_currency ?? m.price_change_percentage_24h,
    change_7d_pct: m.price_change_percentage_7d_in_currency,
    image: m.image,
    fetched_at: new Date().toISOString(),
  }));
}

// Почасовая история цен и объёмов за N дней (для волатильности и медианы объёма).
async function fetchCoinHistory(coinId, days = 7) {
  const url = `${COINGECKO}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=hourly`;
  const data = await fetchRetry(url);
  return {
    prices: data.prices || [],
    volumes: data.total_volumes || [],
  };
}

// Индекс страха и жадности (0..100) за последние 14 дней.
async function fetchFng() {
  const data = await fetchRetry(`${FNG_URL}&limit=14`);
  return (data.data || []).map((d) => ({
    value: Number(d.value),
    classification: d.value_classification || '',
    timestamp: d.timestamp,
    date: d.timestamp ? new Date(Number(d.timestamp) * 1000).toISOString() : null,
  }));
}

module.exports = { COIN_IDS, fetchMarkets, fetchHistory: fetchCoinHistory, fetchFng };