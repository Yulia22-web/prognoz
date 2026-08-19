import React, { useEffect, useState, useCallback } from 'react';
import { api, fmtUsd, fmtPct, fmtTime, DIRECTION_LABEL, STATUS_LABEL } from './api.js';

// Полоса уверенности: цвет зависит от уровня (зелёный ≥65%, жёлтый ≥50%, красный ниже).
function ConfidenceBar({ value }) {
  const pct = Math.round((value ?? 0) * 100);
  const color = pct >= 65 ? 'var(--up)' : pct >= 50 ? 'var(--warn)' : 'var(--down)';
  return (
    <div className="conf">
      <div className="conf-track"><div className="conf-fill" style={{ width: pct + '%', background: color }} /></div>
      <span className="conf-label" style={{ color }}>{pct}%</span>
    </div>
  );
}

// Бейдж направления прогноза (Рост / Падение / Боковик).
function DirectionBadge({ direction }) {
  const cls = direction === 'up' ? 'up' : direction === 'down' ? 'down' : 'flat';
  return <span className={`badge ${cls}`}>{DIRECTION_LABEL[direction] || direction}</span>;
}

// Карточка монеты в списке: цена, изменение за 24ч, последний прогноз.
function CoinCard({ coin, onSelect, selected }) {
  const f = coin.forecast;
  return (
    <div className={`coin-card ${selected ? 'selected' : ''}`} onClick={() => onSelect(coin.id)}>
      <div className="coin-head">
        {coin.image && <img className="coin-img" src={coin.image} alt={coin.name} />}
        <div>
          <div className="coin-name">{coin.name}</div>
          <div className="coin-symbol">{coin.symbol}</div>
        </div>
        <div className="coin-price">
          <div className="price">{fmtUsd(coin.price)}</div>
          <div className={`chg ${(coin.change_24h_pct ?? 0) >= 0 ? 'up' : 'down'}`}>{fmtPct(coin.change_24h_pct)} / 24ч</div>
        </div>
      </div>
      {f ? (
        <div className="coin-forecast">
          <div className="coin-forecast-row">
            <DirectionBadge direction={f.direction} />
            <span className={`status ${f.status}`}>{STATUS_LABEL[f.status]}</span>
          </div>
          <ConfidenceBar value={f.confidence} />
          <div className="coin-meta">
            <span>Score: {f.score != null ? f.score.toFixed(3) : '—'}</span>
            <span>до {fmtTime(f.expires_at)}</span>
          </div>
        </div>
      ) : (
        <div className="coin-forecast empty">Прогноз ещё не построен</div>
      )}
    </div>
  );
}

// Карточка прогноза: направление, уверенность, score, риск, снимок данных,
// сигналы, аргументы и результат сверки с фактической ценой.
function ForecastCard({ forecast }) {
  if (!forecast) return <div className="panel empty">Выберите монету, чтобы увидеть карточку прогноза</div>;
  const inputs = forecast.inputs || {};
  const events = forecast.events || [];
  const outcome = forecast.outcome;

  return (
    <div className="panel forecast-card">
      <div className="fc-head">
        <div>
          <div className="fc-title">{forecast.name} ({forecast.symbol})</div>
          <div className="fc-sub">Прогноз на {forecast.horizon_hours}ч · создан {fmtTime(forecast.created_at)}</div>
        </div>
        <DirectionBadge direction={forecast.direction} />
      </div>

      <div className="fc-grid">
        <div className="fc-block">
          <div className="fc-label">Уверенность</div>
          <ConfidenceBar value={forecast.confidence} />
        </div>
        <div className="fc-block">
          <div className="fc-label">Score (взвешенный)</div>
          <div className="fc-score">{forecast.score != null ? forecast.score.toFixed(3) : '—'}</div>
        </div>
        <div className="fc-block">
          <div className="fc-label">Статус</div>
          <span className={`status ${forecast.status}`}>{STATUS_LABEL[forecast.status]}</span>
        </div>
      </div>

      <div className="fc-section">
        <div className="fc-label">Риск / почему может не сработать</div>
        <p className="fc-risk">{forecast.risk}</p>
      </div>

      <div className="fc-section">
        <div className="fc-label">Использованные данные (снимок на момент прогноза)</div>
        <table className="data-table">
          <tbody>
            <tr><td>Цена</td><td>{fmtUsd(inputs.price)}</td></tr>
            <tr><td>Изменение 24ч</td><td>{fmtPct(inputs.change_24h_pct)}</td></tr>
            <tr><td>Изменение 7д</td><td>{fmtPct(inputs.change_7d_pct)}</td></tr>
            <tr><td>Объём 24ч</td><td>{fmtUsd(inputs.volume_24h)}</td></tr>
            <tr><td>Медиана объёма 7д</td><td>{fmtUsd(inputs.volume_median_7d)}</td></tr>
            <tr><td>Волатильность 7д</td><td>{inputs.volatility_7d != null ? inputs.volatility_7d.toFixed(2) + '%' : '—'}</td></tr>
            <tr><td>Fear & Greed</td><td>{inputs.fng_value != null ? `${inputs.fng_value} (${inputs.fng_classification})` : '—'}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="fc-section">
        <div className="fc-label">Сигналы (нормализованные -1..+1)</div>
        <table className="data-table">
          <tbody>
            <tr><td>Momentum (тренд)</td><td>{inputs.momentum_score?.toFixed(3)}</td></tr>
            <tr><td>Volume (объём)</td><td>{inputs.volume_score?.toFixed(3)}</td></tr>
            <tr><td>Fear & Greed</td><td>{inputs.fng_score?.toFixed(3)}</td></tr>
            <tr><td>News (новостной фон)</td><td>{inputs.news_score?.toFixed(3)}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="fc-section">
        <div className="fc-label">Аргументы / события</div>
        {events.length === 0 ? (
          <p className="muted">Новостных событий не зафиксировано</p>
        ) : (
          <ul className="events">
            {events.map((e, i) => (
              <li key={i}>
                <span className={`ev-dir ${e.sentiment > 0 ? 'up' : e.sentiment < 0 ? 'down' : 'flat'}`}>
                  {e.sentiment > 0 ? '▲' : e.sentiment < 0 ? '▼' : '◆'}
                </span>
                <span>{e.label}: {e.full}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {outcome && (
        <div className="fc-section outcome">
          <div className="fc-label">Результат (как система поняла, что ошиблась)</div>
          <p>
            Фактическое изменение: <b>{fmtPct(outcome.actual_pct)}</b> · Статус:{' '}
            <span className={`status ${outcome.status}`}>{STATUS_LABEL[outcome.status]}</span>
          </p>
          <p className="muted">
            {outcome.status === 'hit'
              ? 'Направление совпало с фактическим движением цены.'
              : 'Направление не совпало — прогноз помечен как неверный, это учитывается в статистике точности.'}
          </p>
        </div>
      )}
    </div>
  );
}

// Панель точности: доля сбывшихся прогнозов из завершённых.
function AccuracyPanel({ dash }) {
  const a = dash?.accuracy;
  if (!a || a.total === 0) return <div className="panel empty">Пока нет завершённых прогнозов — точность появится после истечения горизонта (24ч)</div>;
  return (
    <div className="panel">
      <div className="panel-title">Точность прогнозов</div>
      <div className="acc-grid">
        <div className="acc-big">{a.accuracy}%</div>
        <div className="acc-detail">
          <div>Всего: <b>{a.total}</b></div>
          <div className="up">Сбылось: <b>{a.hit}</b></div>
          <div className="down">Не сбылось: <b>{a.miss}</b></div>
          <div>Истекло: <b>{a.expired}</b></div>
        </div>
      </div>
    </div>
  );
}

// Панель источников данных (из справочника sources в БД).
function SourcesPanel({ sources }) {
  return (
    <div className="panel">
      <div className="panel-title">Источники данных</div>
      <ul className="sources">
        {sources.map((s) => (
          <li key={s.id}>
            <div className="src-name">{s.name} <span className="src-kind">{s.kind}</span></div>
            <div className="src-desc">{s.description}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Панель истории обновлений (fetch / forecast / resolve).
function HistoryPanel({ history }) {
  return (
    <div className="panel">
      <div className="panel-title">История обновлений</div>
      <ul className="history">
        {history.map((h) => (
          <li key={h.id}>
            <span className="h-kind">{h.kind}</span>
            <span className="h-time">{fmtTime(h.run_at)}</span>
            <span className="h-detail">{h.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function App() {
  const [coins, setCoins] = useState([]);
  // Выбранная монета берётся из URL-хэша (#bitcoin), чтобы можно было дать прямую ссылку на карточку.
  const [selected, setSelected] = useState(() => (window.location.hash ? window.location.hash.slice(1) : null));
  const [forecast, setForecast] = useState(null);
  const [dash, setDash] = useState(null);
  const [sources, setSources] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Загрузка всех данных дашборда параллельно.
  const loadAll = useCallback(async () => {
    try {
      const [c, d, s, h] = await Promise.all([api.coins(), api.dashboard(), api.sources(), api.history()]);
      setCoins(c);
      setDash(d);
      setSources(s);
      setHistory(h);
      if (!selected && c.length) setSelected(c[0].id);
      else if (selected) window.location.hash = selected;
      setError(null);
    } catch (e) {
      setError('Не удалось загрузить данные: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // При выборе монеты подгружаем её карточку прогноза и синхронизируем URL-хэш.
  useEffect(() => {
    if (!selected) return;
    window.location.hash = selected;
    api.forecast(selected).then(setForecast).catch(() => setForecast(null));
  }, [selected]);

  // Кнопка «Обновить данные»: дёргает /api/refresh и перезагружает всё.
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await api.refresh();
      await loadAll();
      if (selected) setForecast(await api.forecast(selected));
    } catch (e) {
      setError('Ошибка обновления: ' + e.message);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">🔮</span>
          <div>
            <h1>Предсказатель будущего</h1>
            <p className="tagline">Крипто-прогнозы на 24ч · данные: CoinGecko + Fear & Greed + новостной фон</p>
          </div>
        </div>
        <div className="topbar-right">
          {dash?.fng && (
            <div className="fng-chip" title="Индекс страха и жадности">
              F&G: <b>{dash.fng.value}</b> <span className="muted">({dash.fng.classification})</span>
            </div>
          )}
          <button className="btn" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? 'Обновляю…' : 'Обновить данные'}
          </button>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="loading">Загрузка данных…</div>
      ) : (
        <div className="layout">
          <aside className="sidebar">
            <div className="panel-title">События / объекты прогноза</div>
            <div className="coin-list">
              {coins.map((c) => (
                <CoinCard key={c.id} coin={c} selected={selected === c.id} onSelect={setSelected} />
              ))}
            </div>
          </aside>

          <main className="content">
            <ForecastCard forecast={forecast} />
            <div className="side-grid">
              <AccuracyPanel dash={dash} />
              <SourcesPanel sources={sources} />
            </div>
            <HistoryPanel history={history} />
          </main>
        </div>
      )}

      <footer className="footer">
        Демо-прототип. Прогнозы носят информационный характер и не являются инвестиционной рекомендацией. Реальные деньги не используются.
      </footer>
    </div>
  );
}