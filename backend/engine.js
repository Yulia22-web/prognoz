// Горизонт прогноза в часах: система предсказывает движение цены на сутки вперёд.
const HORIZON_HOURS = 24;

// Веса сигналов в итоговом score. Сумма = 1.0.
// Подбирались эмпирически: тренд и объём — базовые драйверы цены,
// F&G отражает настроение рынка, волатильность — риск, новости — фон.
const WEIGHTS = {
  momentum: 0.30,
  volume: 0.20,
  fng: 0.20,
  volatility: 0.15,
  news: 0.15,
};

// Ограничивает значение диапазоном [lo, hi]. Используется для нормализации
// всех сигналов в единую шкалу -1..+1 перед взвешиванием.
const clamp = (v, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));

// Сигнал «тренд»: комбинация изменения цены за 24ч и за 7д.
// ±3% за сутки и ±8% за неделю считаются сильным движением (→ ±1).
function momentumScore(m) {
  const c24 = clamp((m.change_24h_pct ?? 0) / 3, -1, 1);
  const c7 = clamp((m.change_7d_pct ?? 0) / 8, -1, 1);
  return 0.6 * c24 + 0.4 * c7;
}

// Сигнал «объём»: отношение объёма за 24ч к медиане объёма за неделю.
// Логарифм сглаживает выбросы; ratio ~1.5 (объём выше нормы) даёт ~0.
function volumeScore(m) {
  const vol = m.volume_24h ?? m.volume;
  const med = m.volume_median_7d;
  if (vol == null || med == null || med <= 0) return 0;
  const ratio = vol / med;
  return clamp((Math.log(1 + ratio) - 0.5) / 1.5, -1, 1);
}

// Сигнал «настроение»: индекс Fear & Greed (0..100).
// Жадность (100) — перегрев рынка, склонность к коррекции (отрицательный сигнал);
// страх (0) — паника, после которой часто случается отскок (положительный сигнал).
function fngScore(value) {
  if (value == null) return 0;
  return clamp((50 - value) / 50, -1, 1);
}

// Сигнал «волатильность»: чем выше волатильность, тем ниже уверенность
// и тем ближе прогноз к боковику. При отсутствии данных — нейтрально (0.5).
function volatilityScore(m) {
  const v = m.volatility_7d;
  if (v == null || Number.isNaN(v)) return 0.5;
  return clamp(1 - v / 100, 0, 1);
}

// Сигнал «новости»: сумма тональностей событий, нормированная на √n,
// чтобы несколько слабых событий не перевешивали одно сильное.
function newsScore(events) {
  if (!events || events.length === 0) return 0;
  const sum = events.reduce((s, e) => s + (e.sentiment || 0), 0);
  return clamp(sum / Math.sqrt(events.length), -1, 1);
}

// Собирает прогноз из нормализованных сигналов.
// @param {object} coin    — метаданные монеты + текущие цена/объём/капитализация
// @param {object} metrics — снимок показателей из БД (change_24h_pct, fng_value, newsEvents и т.д.)
// @returns {object} прогноз: направление, score, уверенность, риск, снимок входных данных и событий
function buildForecast(coin, metrics) {
  const mom = momentumScore(metrics);
  const vol = volumeScore(metrics);
  const fng = fngScore(metrics.fng_value);
  const vola = volatilityScore(metrics);
  const news = newsScore(metrics.newsEvents);

  // Взвешенная сумма сигналов — итоговый score в диапазоне -1..+1.
  const raw =
    WEIGHTS.momentum * mom +
    WEIGHTS.volume * vol +
    WEIGHTS.fng * fng +
    WEIGHTS.volatility * vola +
    WEIGHTS.news * news;
  const score = Number.isFinite(raw) ? clamp(raw) : 0;

  // Направление по порогам: |score| < 0.15 считаем боковиком.
  let direction = 'flat';
  if (score > 0.15) direction = 'up';
  else if (score < -0.15) direction = 'down';

  // Уверенность: база 0.55 + вклад силы сигнала + бонус за число активных сигналов.
  // Ограничена 0.05..0.95 — никогда не даём 100%.
  const activeSignals = [mom, vol, fng, news].filter((s) => Math.abs(s) > 0.25).length;
  const confidence = clamp(
    0.55 + 0.45 * Math.abs(score) / 6.5 + 0.08 * Math.min(activeSignals, 3),
    0.05,
    0.95
  );

  // Риски — человекочитаемые причины, почему прогноз может не сработать.
  const riskParts = [];
  if (vola < 0.4) riskParts.push('высокая волатильность');
  if (new Set([mom, vol, fng].map((s) => Math.sign(s))).size > 1) riskParts.push('разнонаправленные сигналы');
  if (newsScore(metrics.newsEvents) === 0) riskParts.push('недостаточно новостного фона');
  if (!riskParts.length) riskParts.push('рынок может отреагировать на внезапные новости');

  return {
    coin_id: coin.coin_id,
    name: coin.name,
    symbol: coin.symbol,
    horizon_hours: HORIZON_HOURS,
    direction,
    score,
    confidence,
    risk: riskParts.join('; ') || 'Нет явных рисков',
    // Полный снимок входных данных — по нему прогноз можно воспроизвести позже.
    inputs: {
      price: coin.price,
      volume_24h: coin.volume_24h,
      volume_median_7d: metrics.volume_median_7d,
      market_cap: coin.market_cap,
      change_24h_pct: coin.change_24h_pct,
      change_7d_pct: coin.change_7d_pct,
      fng_value: metrics.fng_value,
      fng_classification: metrics.fng_classification,
      volatility_7d: metrics.volatility_7d,
      momentum_score: mom,
      volume_score: vol,
      fng_score: fng,
      news_score: news,
      weights: WEIGHTS,
    },
    // События, повлиявшие на прогноз (для карточки «Аргументы»).
    events: (metrics.newsEvents || []).map((e) => ({
      category: e.category,
      label: e.detail || e.label || e.category,
      full: e.title || e.full || '',
      sentiment: e.sentiment != null ? e.sentiment : (e.direction === 'up' ? 0.3 : e.direction === 'down' ? -0.3 : 0),
    })),
  };
}

module.exports = { buildForecast, WEIGHTS, HORIZON_HOURS };