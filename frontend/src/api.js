const BASE = '/api';

// GET-запрос к API с проверкой статуса ответа.
async function get(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// POST-запрос (используется только для /api/refresh).
async function post(path) {
  const res = await fetch(BASE + path, { method: 'POST' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Клиент API: все эндпоинты бэкенда в одном месте.
export const api = {
  coins: () => get('/coins'),
  forecast: (coinId) => get(`/forecast/${coinId}`),
  forecasts: () => get('/forecasts'),
  metrics: (coinId) => get(`/metrics/${coinId}`),
  sources: () => get('/sources'),
  raw: () => get('/raw'),
  history: () => get('/history'),
  dashboard: () => get('/dashboard'),
  refresh: () => post('/refresh'),
};

// Форматирование денежных сумм: $1.5K / $18.5M / $1.2B.
export function fmtUsd(v) {
  if (v == null) return '—';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + v.toFixed(2);
}

// Форматирование процентов со знаком (+1.50%).
export function fmtPct(v) {
  if (v == null) return '—';
  return (v > 0 ? '+' : '') + v.toFixed(2) + '%';
}

// Форматирование ISO-даты в локальный формат (дд.мм, чч:мм).
export function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export const DIRECTION_LABEL = { up: 'Рост', down: 'Падение', flat: 'Боковик' };
export const STATUS_LABEL = { pending: 'Активен', hit: 'Сбылся', miss: 'Не сбылся', expired: 'Истёк' };