// Локальный словарь новостных категорий с тональностью.
// Используется вместо недоступных RSS-лент: по ключевым словам определяем
// категорию события и её влияние на рынок (sentiment: -1..+1).
const NEWS_CATEGORIES = [
  { key: 'etf', keywords: ['etf', 'spot etf', 'grayscale'], sentiment: -0.1, label: 'ETF-новости' },
  { key: 'hack', keywords: ['hack', 'exploit', 'breach', 'stolen', 'drain'], sentiment: -0.6, label: 'Хакерская атака' },
  { key: 'sec', keywords: ['sec', 'lawsuit', 'sued', 'fine'], sentiment: -0.4, label: 'Регуляторное давление' },
  { key: 'adoption', keywords: ['adopt', 'integration', 'partnership', 'mainnet', 'launch'], sentiment: 0.35, label: 'Принятие/интеграция' },
  { key: 'fund', keywords: ['fund', 'investment', 'raise', 'inflow', 'grayscale'], sentiment: 0.3, label: 'Инвестиционный фон' },
  { key: 'macro', keywords: ['fed', 'fomc', 'rate', 'inflation', 'cpi'], sentiment: 0.15, label: 'Макроэкономика' },
];

// Определяет категории новостей по ключевым словам в тексте.
// Возвращает массив совпавших категорий (может быть пустым).
function classifyNews(text) {
  const lower = String(text || '').toLowerCase();
  const found = [];
  for (const cat of NEWS_CATEGORIES) {
    if (cat.keywords.some((k) => lower.includes(k))) found.push(cat);
  }
  return found;
}

// Формирует снимок новостного фона на текущий момент.
// В прототипе — фиксированный набор событий; в проде сюда приходит RSS/API.
async function ingestNewsSnapshot(store) {
  const snapshot = [
    { text: 'SEC disclosure deadlines approaching; regulatory scrutiny continues across crypto markets', category: 'regulation' },
    { text: 'Several major exchanges announce new listings and adoption partnerships', category: 'adoption' },
    { text: 'Macro data: inflation expectations steady, Fed holds rates', category: 'macro' },
  ];
  const events = [];
  for (const item of snapshot) {
    const cats = classifyNews(item.text);
    events.push({ category: cats.length ? cats[0].key : item.category, label: cats.length ? cats[0].label : item.category, sentiment: cats.length ? cats[0].sentiment : 0, full: item.text });
  }
  return events;
}

module.exports = {
  NEWS_CATEGORIES,
  classifyNews,
  ingestNewsSnapshot,
};