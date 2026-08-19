const { fetchAndStore, generateForecasts, resolveForecasts } = require('../pipeline');
const store = require('../store');

// Разовый прогон без запуска сервера: обновить данные → прогнозы → сверка.
// Удобно для первого запуска и проверки сходимости цифр.
(async () => {
  try {
    console.log('[RUN] fetch sources...');
    const fetchRes = await fetchAndStore();
    console.log('[RUN] fetch:', JSON.stringify(fetchRes));

    console.log('[RUN] generate forecasts...');
    const created = generateForecasts();
    console.log('[RUN] forecasts created:', created);

    console.log('[RUN] resolve expired...');
    const resolved = resolveForecasts();
    console.log('[RUN] resolved:', JSON.stringify(resolved));

    console.log('[RUN] done. History:');
    console.log(store.getHistory(5));
  } catch (e) {
    console.error('[RUN] failed:', e);
    process.exit(1);
  }
})();