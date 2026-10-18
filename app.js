import { DISTRICTS, CHENNAI_AREAS } from './locations.js';

const API = 'https://api.open-meteo.com/v1/forecast';
const OFFICIAL_URL = 'data/official.json';
const BOUNDARIES_URL = 'data/tn-districts.geojson';
const REFRESH_MS = 15 * 60 * 1000;
const NOTIFY_KEY = 'tn-rain-notified';

// IMD 24-hour rainfall categories, used for model forecasts and gauge readings.
const LEVELS = [
  { key: 'none', label: 'Dry', min: 0, color: '#9aa5b1' },
  { key: 'light', label: 'Light', min: 2.5, color: '#7cc4f0' },
  { key: 'moderate', label: 'Moderate', min: 15.6, color: '#2f86d6' },
  { key: 'heavy', label: 'Heavy', min: 64.5, color: '#f2c94c' },
  { key: 'veryheavy', label: 'Very heavy', min: 115.6, color: '#f2994a' },
  { key: 'extreme', label: 'Extremely heavy', min: 204.5, color: '#eb5757' },
];
const HEAVY = 3;

// IMD warning colours, stored by the data job as 0 green .. 3 red.
const WARN = [
  { label: 'Green', color: '#7bc67e', advice: 'No warning' },
  { label: 'Yellow', color: '#f2c94c', advice: 'Be updated' },
  { label: 'Orange', color: '#f2994a', advice: 'Be prepared' },
  { label: 'Red', color: '#eb5757', advice: 'Take action' },
];

// Hourly intensity, mm/h.
const RATE_COLORS = [[50, '#eb5757'], [7.6, '#f2994a'], [2.5, '#2f86d6'], [0.1, '#7cc4f0'], [0, '#9aa5b1']];

const WMO = {
  0: ['Clear', '☀️'], 1: ['Mostly clear', '🌤️'], 2: ['Partly cloudy', '⛅'], 3: ['Overcast', '☁️'],
  45: ['Fog', '🌫️'], 48: ['Fog', '🌫️'],
  51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Heavy drizzle', '🌧️'],
  61: ['Light rain', '🌦️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '🌧️'],
  80: ['Light showers', '🌦️'], 81: ['Showers', '🌧️'], 82: ['Violent showers', '⛈️'],
  95: ['Thunderstorm', '⛈️'], 96: ['Thunderstorm, hail', '⛈️'], 99: ['Thunderstorm, hail', '⛈️'],
};

const SOURCE_LABELS = {
  warnings: 'IMD district warnings', nowcast: 'IMD nowcast', gauges: 'IMD rain gauges',
  rainDaily: 'IMD district rainfall', rainMonth: 'IMD month-to-date', alerts: 'NDMA alerts',
  lakes: 'Chennai lakes', dams: 'Reservoir telemetry',
};

const state = {
  view: 'tn',
  data: { tn: [], chennai: [] },
  official: null,
  boundaries: null,
  selected: null,
  season: null,
  fitted: null,
};

const levelFor = (mm) => LEVELS.reduce((acc, l, i) => (mm >= l.min ? i : acc), 0);
const rateColor = (mm) => RATE_COLORS.find(([min]) => mm >= min)[1];
const wmo = (code) => WMO[code] ?? ['—', '🌡️'];
const fmt = (n) => (n == null ? '—' : n < 0.05 ? '0' : n < 10 ? n.toFixed(1) : Math.round(n).toString());
const sum = (arr) => arr.reduce((s, v) => s + (v ?? 0), 0);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const title = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const IST = { timeZone: 'Asia/Kolkata' };
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { ...IST, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
const fmtDay = (ymd, k = 0) => {
  if (!ymd) return '—';
  const d = new Date(`${ymd}T12:00:00+05:30`);
  d.setDate(d.getDate() + k);
  return d.toLocaleDateString('en-IN', { ...IST, weekday: 'short', day: 'numeric', month: 'short' });
};
const signed = (n) => (n == null ? '—' : `<span class="${n >= 0 ? 'up' : 'down'}">${n > 0 ? '+' : ''}${Math.round(n)}%</span>`);

function km(aLat, aLon, bLat, bLon) {
  const r = Math.PI / 180;
  const x = (bLon - aLon) * r * Math.cos(((aLat + bLat) / 2) * r);
  const y = (bLat - aLat) * r;
  return 6371 * Math.hypot(x, y);
}

// Season-to-date window: NE monsoon from 1 Oct, SW monsoon from 1 Jun, else last 30 days.
function seasonWindow(now = new Date()) {
  const m = now.getMonth();
  let start, label;
  if (m >= 9) [start, label] = [new Date(now.getFullYear(), 9, 1), 'Since 1 Oct'];
  else if (m >= 5) [start, label] = [new Date(now.getFullYear(), 5, 1), 'Since 1 Jun'];
  else [start, label] = [new Date(now - 30 * 864e5), 'Last 30 days'];
  let days = Math.ceil((now - start) / 864e5);
  if (days > 92) [days, label] = [92, 'Last 92 days'];
  return { days: Math.max(days, 1), label };
}

// ---------- data ----------

async function fetchPlaces(places, pastDays) {
  const params = new URLSearchParams({
    latitude: places.map((p) => p.lat).join(','),
    longitude: places.map((p) => p.lon).join(','),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m',
    hourly: 'precipitation,precipitation_probability',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max',
    timezone: 'Asia/Kolkata',
    past_days: pastDays,
    forecast_days: 7,
  });
  const res = await fetch(`${API}?${params}`);
  if (!res.ok) throw new Error(`Open-Meteo returned ${res.status}`);
  const json = await res.json();
  const list = Array.isArray(json) ? json : [json];
  return list.map((d, k) => summarize(places[k], d));
}

function summarize(place, d) {
  const h = d.hourly;
  const nowKey = d.current.time.slice(0, 13) + ':00';
  const i = Math.max(0, h.time.indexOf(nowKey));
  const today = d.daily.time.indexOf(d.current.time.slice(0, 10));
  const next24 = sum(h.precipitation.slice(i + 1, i + 25));
  return {
    ...place,
    raw: d,
    i,
    today,
    rate: h.precipitation[i] ?? 0,
    past24: sum(h.precipitation.slice(Math.max(0, i - 23), i + 1)),
    next24,
    prob24: Math.max(0, ...h.precipitation_probability.slice(i + 1, i + 25).map((v) => v ?? 0)),
    season: sum(h.precipitation.slice(0, i + 1)),
    level: levelFor(next24),
  };
}

// Official data is produced by scripts/update-data.mjs; the page still works without it.
async function fetchOfficial() {
  try {
    const res = await fetch(OFFICIAL_URL, { cache: 'no-store' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function fetchBoundaries() {
  if (state.boundaries) return state.boundaries;
  try {
    const res = await fetch(BOUNDARIES_URL);
    state.boundaries = res.ok ? await res.json() : null;
  } catch {
    state.boundaries = null;
  }
  return state.boundaries;
}

const stations = () => state.official?.gauges?.stations ?? [];
const gaugesIn = (district) => stations().filter((s) => s.district === district).sort((a, b) => (b.mm[0] ?? -1) - (a.mm[0] ?? -1));
const nearestGauges = (lat, lon, n = 5) => stations()
  .filter((s) => s.mm[0] != null)
  .map((s) => ({ ...s, dist: km(lat, lon, s.lat, s.lon) }))
  .sort((a, b) => a.dist - b.dist)
  .slice(0, n);

function officialFor(name) {
  const o = state.official ?? {};
  return {
    warn: o.warnings?.districts?.[name] ?? null,
    nowcast: o.nowcast?.districts?.[name] ?? null,
    day: o.rainDaily?.districts?.[name] ?? null,
    month: o.rainMonth?.districts?.[name] ?? null,
  };
}

const warnLevelToday = (name) => officialFor(name).warn?.[0]?.level ?? -1;

// ---------- map ----------

const map = L.map('map', { zoomControl: true }).setView([10.9, 78.6], 7);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 14,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

const warnLayer = L.geoJSON(null, {
  style: (f) => {
    const l = warnLevelToday(f.properties.name);
    return { color: '#55606e', weight: 0.6, fillColor: l >= 0 ? WARN[l].color : 'transparent', fillOpacity: l >= 1 ? 0.45 : 0.15 };
  },
  onEachFeature: (f, layer) => {
    const w = officialFor(f.properties.name).warn?.[0];
    layer.bindTooltip(`<b>${esc(f.properties.name)}</b><br>IMD today: ${w ? `${WARN[w.level]?.label ?? '—'}${w.hazards.length ? ` · ${esc(w.hazards.join(', '))}` : ''}` : 'no data'}`, { sticky: true });
    layer.on('click', () => select(f.properties.name));
  },
}).addTo(map);
// Off by default: the table already lists the model forecast, and the map reads better with official data.
const modelLayer = L.layerGroup();
const gaugeLayer = L.layerGroup().addTo(map);
L.control.layers(null, {
  'IMD warning today': warnLayer,
  'Forecast next 24h (model)': modelLayer,
  'Rain gauges, last 24h (IMD)': gaugeLayer,
}, { collapsed: window.innerWidth < 700 }).addTo(map);

function renderMap(rows) {
  warnLayer.clearLayers();
  if (state.boundaries) warnLayer.addData(state.boundaries);

  modelLayer.clearLayers();
  for (const r of rows) {
    const lvl = LEVELS[r.level];
    L.circleMarker([r.lat, r.lon], { radius: 6 + r.level * 2.5, color: '#1b2430', weight: 1, fillColor: lvl.color, fillOpacity: 0.95 })
      .bindTooltip(`<b>${esc(r.name)}</b><br>Model next 24h: ${fmt(r.next24)} mm (${lvl.label})<br>Now: ${fmt(r.rate)} mm/h`)
      .on('click', () => select(r.name))
      .addTo(modelLayer);
  }

  gaugeLayer.clearLayers();
  for (const s of stations()) {
    const mm = s.mm[0];
    if (!mm) continue;
    L.circleMarker([s.lat, s.lon], { radius: 2.5 + Math.min(mm, 200) / 25, color: '#0b3d6e', weight: 1, fillColor: LEVELS[levelFor(mm)].color, fillOpacity: 0.9 })
      .bindTooltip(`<b>${esc(title(s.name))}</b> (${esc(s.district)})<br>IMD gauge, 24h: <b>${fmt(mm)} mm</b><br>7 days: ${fmt(s.mm[6])} mm`)
      .addTo(gaugeLayer);
  }

  if (state.fitted !== state.view && rows.length) {
    map.fitBounds(rows.map((r) => [r.lat, r.lon]), { padding: [30, 30], maxZoom: 11 });
    state.fitted = state.view;
  }
}

// ---------- alerts + banner ----------

function renderAlerts() {
  const el = document.getElementById('alerts');
  const list = (state.official?.alerts ?? []).filter((a) => Date.parse(a.expires) > Date.now());
  if (!list.length) { el.hidden = true; return; }
  el.innerHTML = `<h2>⚠️ Official alerts now in force (IMD Chennai via NDMA)</h2><ul>${list.slice(0, 6).map((a) => `
    <li>${esc(a.headline)} <span class="small">· ${esc(a.event ?? '')}, valid till ${fmtTime(a.expires)} ·
    <a href="${esc(a.link)}" target="_blank" rel="noopener">source</a></span></li>`).join('')}</ul>`;
  el.hidden = false;
}

function renderBanner(rows) {
  const el = document.getElementById('banner');
  if (state.view === 'lakes') { el.innerHTML = ''; return; }
  const unit = state.view === 'tn' ? 'districts' : 'areas';
  const pills = [];

  if (state.view === 'tn' && state.official?.warnings) {
    const counts = [0, 0, 0, 0];
    for (const d of DISTRICTS) { const l = warnLevelToday(d.name); if (l >= 0) counts[l]++; }
    const parts = [3, 2, 1].filter((l) => counts[l]).map((l) => `<span class="chip" style="--c:${WARN[l].color}">${counts[l]} ${WARN[l].label.toLowerCase()}</span>`);
    pills.push(`<span class="pill">IMD warnings today: ${parts.join(' ') || 'none'}</span>`);
    const now = Object.values(state.official.nowcast?.districts ?? {}).filter((n) => n.level >= 1).length;
    if (now) pills.push(`<span class="pill">IMD 3-hour nowcast: <b>&nbsp;${now} districts</b>&nbsp;under alert</span>`);
  }

  const counts = LEVELS.map(() => 0);
  rows.forEach((r) => counts[r.level]++);
  const heavy = counts.slice(HEAVY).reduce((a, b) => a + b, 0);
  pills.push(heavy
    ? `<span class="pill">Model: <b>&nbsp;${heavy} ${unit}</b>&nbsp;heavy rain or worse in 24h</span>`
    : `<span class="pill">Model: no heavy rain in the next 24h</span>`);
  el.innerHTML = pills.join('');
}

// ---------- table ----------

const shortHazard = (h) => h.replace('Thunderstorm & lightning', 'Thunderstorm');

function warnChip(day) {
  if (!day || day.level == null) return '<span class="small">—</span>';
  const w = WARN[day.level];
  const hz = day.hazards.length ? `<div class="small">${esc(day.hazards.map(shortHazard).join(', '))}</div>` : '';
  return `<span class="chip" style="--c:${w.color}" title="${w.advice}">${w.label}</span>${hz}`;
}

function nowCell(r) {
  const [text, icon] = wmo(r.raw.current.weather_code);
  const rain = r.rate >= 0.1 ? ` <b style="color:${rateColor(r.rate)}">${fmt(r.rate)} mm/h</b>` : '';
  return `<span title="${text}">${icon} ${Math.round(r.raw.current.temperature_2m)}°</span>${rain}`;
}

function renderList(rows) {
  const o = state.official;
  const head = document.getElementById('head');
  const body = document.getElementById('rows');
  const sel = (r) => (r.name === state.selected ? 'selected' : '');
  const dot = (r) => `<span class="dot" style="background:${LEVELS[r.level].color}" title="Model forecast: ${LEVELS[r.level].label}"></span>`;

  if (state.view === 'tn') {
    head.innerHTML = `<tr>
      <th>District</th><th>Now</th><th>IMD today</th>
      <th class="num" title="IMD district average for the 24h to 8:30 am; largest single gauge below">Rain ${o?.rainDaily?.date ? fmtDay(o.rainDaily.date).replace(/^\w+, /, '') : '24h'}</th>
      <th class="num" title="Model forecast for the next 24 hours">Next 24h</th>
      <th class="num" title="IMD month-to-date actual and departure from normal">This month</th></tr>`;
    body.innerHTML = rows.map((r) => {
      const { warn, day, month } = officialFor(r.name);
      const top = gaugesIn(r.name)[0];
      return `<tr data-name="${esc(r.name)}" class="${sel(r)}">
        <td>${dot(r)} ${esc(r.name)}</td>
        <td>${nowCell(r)}</td>
        <td class="wrap">${warnChip(warn?.[0])}</td>
        <td class="num">${fmt(day?.actual)}${top?.mm[0] ? `<div class="small" title="${esc(title(top.name))}">max ${fmt(top.mm[0])}</div>` : ''}</td>
        <td class="num"><b>${fmt(r.next24)}</b> <span class="cond">${r.prob24}%</span></td>
        <td class="num">${fmt(month?.actual)}<div class="small">${signed(month?.departure)}</div></td>
      </tr>`;
    }).join('');
  } else {
    head.innerHTML = `<tr>
      <th>Area</th><th>Now</th>
      <th title="Closest IMD rain gauge, 24h to 8:30 am">Nearest gauge</th>
      <th class="num" title="Model estimate">Past 24h</th>
      <th class="num" title="Model forecast">Next 24h</th>
      <th class="num" title="Model estimate">${state.season.label}</th></tr>`;
    body.innerHTML = rows.map((r) => {
      const g = nearestGauges(r.lat, r.lon, 1)[0];
      return `<tr data-name="${esc(r.name)}" class="${sel(r)}">
        <td>${dot(r)} ${esc(r.name)}</td>
        <td>${nowCell(r)}</td>
        <td>${g ? `<b>${fmt(g.mm[0])} mm</b> <span class="small">${esc(title(g.name))}, ${g.dist.toFixed(1)} km</span>` : '<span class="small">—</span>'}</td>
        <td class="num">${fmt(r.past24)}</td>
        <td class="num"><b>${fmt(r.next24)}</b> <span class="cond">${r.prob24}%</span></td>
        <td class="num">${fmt(r.season)}</td>
      </tr>`;
    }).join('');
  }
}

document.getElementById('rows').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-name]');
  if (tr) select(tr.dataset.name);
});

// ---------- detail ----------

function barChart(values, labels, nowIdx) {
  const W = 760, H = 170, l = 30, b = 20, t = 8, r = 6;
  const max = Math.max(5, ...values);
  const bw = (W - l - r) / values.length;
  const y = (v) => t + (H - t - b) * (1 - v / max);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Hourly rainfall">`;
  for (const v of [0, max / 2, max]) {
    svg += `<line class="gridline" x1="${l}" x2="${W - r}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text x="${l - 4}" y="${y(v) + 3}" text-anchor="end">${fmt(v)}</text>`;
  }
  values.forEach((v, k) => {
    const x = l + k * bw;
    if (v > 0) svg += `<rect x="${x + 0.5}" y="${y(v)}" width="${Math.max(bw - 1, 1)}" height="${y(0) - y(v)}" fill="${rateColor(v)}"><title>${labels[k]}: ${fmt(v)} mm</title></rect>`;
    if (labels[k].endsWith('00:00')) svg += `<text x="${x}" y="${H - 6}">${labels[k].slice(5, 10)}</text>`;
  });
  const nx = l + (nowIdx + 0.5) * bw;
  svg += `<line class="now" x1="${nx}" x2="${nx}" y1="${t}" y2="${H - b}"/><text x="${nx + 3}" y="${t + 9}">now</text>`;
  return svg + '</svg>';
}

function gaugeTable(list, withDistance) {
  if (!list.length) return '<p class="small">No IMD gauge readings.</p>';
  return `<table class="mini"><thead><tr><th>Station</th>${withDistance ? '<th class="num">Distance</th>' : ''}
    <th class="num">24h</th><th class="num">7 days</th></tr></thead><tbody>${list.map((s) => `<tr>
      <td>${esc(title(s.name))}${withDistance ? ` <span class="small">${esc(s.district)}</span>` : ''}</td>
      ${withDistance ? `<td class="num">${s.dist.toFixed(1)} km</td>` : ''}
      <td class="num" style="color:${s.mm[0] >= 64.5 ? LEVELS[levelFor(s.mm[0])].color : 'inherit'}"><b>${fmt(s.mm[0])}</b></td>
      <td class="num">${fmt(s.mm[6])}</td></tr>`).join('')}</tbody></table>`;
}

function officialDetail(r) {
  const o = state.official;
  if (!o) return '';
  const isDistrict = DISTRICTS.some((d) => d.name === r.name);
  let html = '';
  if (isDistrict) {
    const { warn, nowcast, day, month } = officialFor(r.name);
    if (warn) {
      html += `<h3>IMD warnings, next 5 days <span class="small">(issued ${fmtTime(o.warnings.updatedAt)})</span></h3>
        <div class="warn-days">${warn.map((w, k) => `<div class="warn-day" style="--c:${WARN[w.level]?.color ?? 'var(--row-hover)'}">
          <b>${k === 0 ? 'Today' : fmtDay(o.warnings.date, k)}</b>
          <span>${WARN[w.level]?.label ?? '—'}${w.hazards.length ? ` · ${esc(w.hazards.join(', '))}` : ''}</span></div>`).join('')}</div>`;
    }
    if (nowcast?.level >= 1) {
      html += `<p><span class="chip" style="--c:${WARN[nowcast.level].color}">Nowcast ${WARN[nowcast.level].label}</span>
        IMD 3-hour warning, ${esc(nowcast.from)}–${esc(nowcast.to)} hrs${nowcast.message ? `: ${esc(nowcast.message)}` : ''}</p>`;
    }
    if (day || month) {
      html += `<div class="stats">
        <div class="stat"><b>${fmt(day?.actual)} mm</b><span>IMD district avg, 24h to 8:30 am ${day ? fmtDay(o.rainDaily.date) : ''}</span></div>
        <div class="stat"><b>${fmt(month?.actual)} mm</b><span>this month vs normal ${fmt(month?.normal)} mm (${signed(month?.departure)})</span></div></div>`;
    }
    html += `<h3>IMD rain gauges in ${esc(r.name)} <span class="small">(24h and 7 days to 8:30 am ${fmtDay(o.gauges?.endDate)})</span></h3>
      ${gaugeTable(gaugesIn(r.name).slice(0, 10), false)}`;
  } else {
    html += `<h3>Nearest IMD rain gauges <span class="small">(to 8:30 am ${fmtDay(o.gauges?.endDate)})</span></h3>
      ${gaugeTable(nearestGauges(r.lat, r.lon, 6), true)}`;
  }
  return html;
}

function renderDetail() {
  const el = document.getElementById('detail');
  const r = [...state.data.tn, ...state.data.chennai].find((x) => x.name === state.selected);
  if (!r || state.view === 'lakes') { el.hidden = true; return; }
  const { current: c, hourly: h, daily: d } = r.raw;
  const from = Math.max(0, r.i - 24);
  const to = Math.min(h.time.length, r.i + 49);
  const [text, icon] = wmo(c.weather_code);
  const days = d.time.slice(r.today, r.today + 7).map((date, k) => {
    const j = r.today + k;
    const mm = d.precipitation_sum[j] ?? 0;
    return `<div class="day">
      <small>${k === 0 ? 'Today' : fmtDay(date)}</small>
      <div class="ic">${wmo(d.weather_code[j])[1]}</div>
      <div class="mm" style="color:${LEVELS[levelFor(mm)].color}">${fmt(mm)} mm</div>
      <small>${d.precipitation_probability_max[j] ?? 0}% · ${Math.round(d.temperature_2m_max[j])}°/${Math.round(d.temperature_2m_min[j])}°</small>
    </div>`;
  }).join('');
  el.innerHTML = `
    <h2>${icon} ${esc(r.name)}</h2>
    <div class="cond">${text} · model expects ${LEVELS[r.level].label.toLowerCase()} rain in the next 24h</div>
    <div class="stats">
      <div class="stat"><b>${Math.round(c.temperature_2m)}°C</b><span>feels ${Math.round(c.apparent_temperature)}°</span></div>
      <div class="stat"><b>${c.relative_humidity_2m}%</b><span>humidity</span></div>
      <div class="stat"><b>${Math.round(c.wind_speed_10m)} km/h</b><span>gusts ${Math.round(c.wind_gusts_10m)}</span></div>
      <div class="stat"><b>${fmt(r.next24)} mm</b><span>model next 24h (${r.prob24}%)</span></div>
      <div class="stat"><b>${fmt(r.season)} mm</b><span>model ${state.season.label.toLowerCase()}</span></div>
    </div>
    ${officialDetail(r)}
    <h3>Hourly rain, past 24h and next 48h (model, mm)</h3>
    ${barChart(h.precipitation.slice(from, to).map((v) => v ?? 0), h.time.slice(from, to), r.i - from)}
    <h3>7-day outlook (model)</h3>
    <div class="days">${days}</div>`;
  el.hidden = false;
}

function select(name) {
  state.selected = name;
  renderList(currentRows());
  renderDetail();
  document.getElementById('detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---------- lakes ----------

const bar = (value, total) => {
  const pct = total ? (100 * value) / total : 0;
  return `<div class="bar"><i style="width:${Math.min(pct, 100).toFixed(1)}%"></i><span>${fmt(value)} / ${fmt(total)} mcft · ${pct.toFixed(0)}%</span></div>`;
};

function renderLakes() {
  const el = document.getElementById('lakes');
  if (state.view !== 'lakes') { el.hidden = true; return; }
  const o = state.official;
  if (!o?.lakes) {
    el.innerHTML = '<p>Lake data is not available yet.</p>';
    el.hidden = false;
    return;
  }
  const dams = o.dams ?? [];
  const latest = (name) => dams.find((d) => d.name.toLowerCase().startsWith(name.toLowerCase().split(' ')[0]));
  const rows = o.lakes.lakes.filter((l) => l.name !== 'Total');
  const total = o.lakes.lakes.find((l) => l.name === 'Total');
  const others = dams.filter((d) => !rows.some((l) => d.name.toLowerCase().startsWith(l.name.toLowerCase().split(' ')[0])));

  el.innerHTML = `
    <h2>Chennai water supply lakes</h2>
    <p class="small">Chennai Metro Water report as on ${fmtDay(o.lakes.asOn)}. "Latest" is reservoir telemetry from TN WRD.</p>
    <table>
      <thead><tr><th>Lake</th><th>Storage</th><th class="num">Latest</th><th class="num">Level / full (ft)</th>
        <th class="num">Inflow</th><th class="num">Outflow</th><th class="num">Rain</th><th class="num">Last year</th></tr></thead>
      <tbody>${rows.map((l) => {
        const t = latest(l.name);
        return `<tr>
          <td>${esc(l.name)}</td>
          <td>${bar(l.storageMcft, l.capacityMcft)}</td>
          <td class="num">${t ? `${fmt(t.storageMcft)}<div class="small">${fmtTime(t.observedAt)}</div>` : '—'}</td>
          <td class="num">${fmt(l.levelFt)} / ${fmt(l.fullLevelFt)}</td>
          <td class="num">${fmt(l.inflowCusecs)}</td>
          <td class="num">${fmt(l.outflowCusecs)}</td>
          <td class="num">${fmt(l.rainMm)} mm</td>
          <td class="num">${fmt(l.lastYearMcft)}</td></tr>`;
      }).join('')}
      ${total ? `<tr><td><b>Total</b></td><td>${bar(total.storageMcft, total.capacityMcft)}</td><td></td><td></td>
        <td class="num"><b>${fmt(total.inflowCusecs)}</b></td><td class="num"><b>${fmt(total.outflowCusecs)}</b></td><td></td>
        <td class="num">${fmt(total.lastYearMcft)}</td></tr>` : ''}
      </tbody>
    </table>
    <p class="small">Storage in million cubic feet (mcft); inflow and outflow in cubic feet per second (cusecs).</p>
    ${others.length ? `<h3>Other reservoirs</h3>
      <table><thead><tr><th>Reservoir</th><th>Storage</th><th class="num">Reading</th></tr></thead><tbody>
      ${others.map((d) => `<tr><td>${esc(d.name)}</td><td>${bar(d.storageMcft, d.capacityMcft)}</td><td class="num">${fmtTime(d.observedAt)}</td></tr>`).join('')}
      </tbody></table>` : ''}`;
  el.hidden = false;
}

// ---------- sources ----------

function renderSources() {
  const el = document.getElementById('sources');
  const s = state.official?.sources;
  if (!s) { el.innerHTML = '<span class="small">Official data not loaded; showing model data only.</span>'; return; }
  el.innerHTML = `<span>Official data checked ${fmtTime(state.official.generatedAt)}:</span>` + Object.entries(s).map(([k, v]) =>
    `<span class="${v.ok ? '' : 'bad'}" title="${esc(v.error ?? '')}">${v.ok ? '✓' : '✗'} ${SOURCE_LABELS[k] ?? k}${v.ok ? '' : ` (last good ${fmtTime(v.fetchedAt)})`}</span>`).join('');
}

// ---------- notifications ----------

function readNotified() {
  try { return JSON.parse(localStorage.getItem(NOTIFY_KEY)) ?? {}; } catch { return {}; }
}

function notifyAll() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const seen = readNotified();
  const date = new Date().toISOString().slice(0, 10);
  const items = [];
  for (const r of [...state.data.tn, ...state.data.chennai]) {
    if (r.level >= HEAVY) items.push({ id: `model|${r.name}|${date}|${r.level}`, title: `${LEVELS[r.level].label} rain forecast: ${r.name}`, body: `${fmt(r.next24)} mm in the next 24h (${r.prob24}% chance, model).` });
  }
  for (const d of DISTRICTS) {
    const w = officialFor(d.name).warn?.[0];
    if (w?.level >= 2) items.push({ id: `imd|${d.name}|${state.official.warnings.date}|${w.level}`, title: `IMD ${WARN[w.level].label} warning: ${d.name}`, body: w.hazards.join(', ') || WARN[w.level].advice });
  }
  for (const a of state.official?.alerts ?? []) {
    items.push({ id: `cap|${a.headline}|${a.effective}`, title: `IMD alert: ${a.event ?? 'Weather'}`, body: a.headline });
  }
  for (const it of items) {
    if (seen[it.id]) continue;
    new Notification(it.title, { body: it.body });
    seen[it.id] = date;
  }
  // Forget entries older than a week.
  for (const [k, v] of Object.entries(seen)) if (Date.now() - Date.parse(v) > 7 * 864e5) delete seen[k];
  try { localStorage.setItem(NOTIFY_KEY, JSON.stringify(seen)); } catch { /* storage unavailable */ }
}

const notifyBtn = document.getElementById('notify');
function syncNotifyBtn() {
  if (!('Notification' in window)) { notifyBtn.hidden = true; return; }
  notifyBtn.textContent = Notification.permission === 'granted' ? 'Alerts on' : 'Enable alerts';
  notifyBtn.disabled = Notification.permission !== 'default';
}
notifyBtn.addEventListener('click', async () => {
  await Notification.requestPermission();
  syncNotifyBtn();
  notifyAll();
});

// ---------- wiring ----------

function currentRows() {
  const rows = [...(state.data[state.view] ?? [])];
  if (state.view === 'tn') return rows.sort((a, b) => warnLevelToday(b.name) - warnLevelToday(a.name) || b.next24 - a.next24);
  return rows.sort((a, b) => b.next24 - a.next24 || b.rate - a.rate);
}

function render() {
  const rows = currentRows();
  document.getElementById('grid').hidden = state.view === 'lakes';
  renderAlerts();
  renderBanner(rows);
  if (state.view !== 'lakes') {
    renderList(rows);
    renderMap(rows);
    map.invalidateSize();
  }
  renderDetail();
  renderLakes();
  renderSources();
}

document.querySelectorAll('.tabs button').forEach((btn) => btn.addEventListener('click', () => {
  state.view = btn.dataset.view;
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
  if (state.view === 'chennai' && !CHENNAI_AREAS.some((a) => a.name === state.selected)) state.selected = 'Nungambakkam';
  if (state.view === 'tn' && !DISTRICTS.some((d) => d.name === state.selected)) state.selected = 'Chennai';
  render();
}));

async function load() {
  const updated = document.getElementById('updated');
  updated.textContent = 'Updating…';
  try {
    state.season = seasonWindow();
    const [tn, chennai, official] = await Promise.all([
      fetchPlaces(DISTRICTS, state.season.days),
      fetchPlaces(CHENNAI_AREAS, state.season.days),
      fetchOfficial(),
      fetchBoundaries(),
    ]);
    state.data = { tn, chennai };
    state.official = official;
    state.selected ??= 'Chennai';
    render();
    notifyAll();
    updated.textContent = `Updated ${new Date().toLocaleTimeString('en-IN', { ...IST, hour: '2-digit', minute: '2-digit' })} IST · auto-refresh every 15 min`;
  } catch (err) {
    updated.textContent = `Could not load data: ${err.message}. Retrying in 15 min.`;
  }
}

document.getElementById('refresh').addEventListener('click', load);
syncNotifyBtn();
load();
setInterval(load, REFRESH_MS);
