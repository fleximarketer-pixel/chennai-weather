// Collects official data (IMD, NDMA, Chennai Metro Water, TN WRD) into data/official.json.
// None of these sources allow browser requests, so this runs on a schedule and the page
// reads the JSON it writes. Each source is independent: if one fails, its last good value
// is kept and marked stale.
import https from 'node:https';
import tls from 'node:tls';
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { DISTRICTS, imdKey } from '../locations.js';

const OUT = new URL('../data/official.json', import.meta.url);
const BOUNDARIES = new URL('../data/tn-districts.geojson', import.meta.url);
const UA = 'Mozilla/5.0 (TN Rain Watch; +https://github.com/fleximarketer-pixel/chennai-weather)';
const IMD_OWS = 'https://reactjs.imd.gov.in/geoserver/ows?service=WFS&version=1.1.0&request=GetFeature&outputFormat=application/json';
const DRMS_OWS = 'https://webgis.imd.gov.in/geoserver/IMD_Data/ows?service=WFS&version=1.0.0&request=GetFeature&outputFormat=application/json';
const TN_BOX = 'lat BETWEEN 8 AND 13.6 AND long BETWEEN 76.2 AND 80.4';

const HAZARDS = {
  1: 'No warning', 2: 'Heavy rain', 3: 'Snow', 4: 'Thunderstorm & lightning', 5: 'Hail', 6: 'Dust storm',
  7: 'Dust-raising winds', 8: 'Strong winds', 9: 'Heat wave', 10: 'Hot day', 11: 'Warm night', 12: 'Cold wave',
  13: 'Cold day', 14: 'Frost', 15: 'Fog', 16: 'Very heavy rain', 17: 'Extremely heavy rain',
};

const byKey = new Map();
for (const d of DISTRICTS) for (const n of [d.name, ...(d.imd ?? [])]) byKey.set(imdKey(n), d.name);
const districtOf = (imdName) => byKey.get(imdKey(imdName ?? ''));

const num = (s) => {
  const t = String(s ?? '').replace(/,/g, '').trim();
  return t === '' || t === '-' || Number.isNaN(Number(t)) ? null : Number(t);
};
const stripTags = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// webgis.imd.gov.in does not send its intermediate certificate, so it is bundled here.
const CA = [...tls.rootCertificates, readFileSync(new URL('./certs/emsign-ssl-ca-g1.pem', import.meta.url), 'utf8')];

async function get(url, { type = 'json', insecure = false, timeout = 45000, tries = 3, check } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const body = await request(url, { insecure, timeout });
      let value = body;
      if (type === 'json') {
        value = JSON.parse(body);
        if (typeof value === 'string') value = JSON.parse(value);
      }
      check?.(value);
      return value;
    } catch (err) {
      lastErr = err;
      if (attempt < tries) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastErr;
}

// `insecure` skips certificate checks. Only wrd.tn.gov.in uses it: its certificate has expired.
function request(url, { insecure, timeout, redirects = 3 }) {
  const { host } = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'user-agent': UA }, ca: CA, rejectUnauthorized: !insecure, timeout }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        resolve(request(new URL(res.headers.location, url).href, { insecure, timeout, redirects: redirects - 1 }));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (body += d));
      res.on('end', () => (res.statusCode === 200 ? resolve(body) : reject(new Error(`HTTP ${res.statusCode} from ${host}`))));
    });
    req.on('timeout', () => req.destroy(new Error(`timeout from ${host}`)));
    req.on('error', (err) => reject(new Error(`${err.code ?? err.message} from ${host}`)));
  });
}

// ---------- IMD district warnings, days 1-5 ----------

// IMD colour codes: 1 red, 2 orange, 3 yellow, 4 green. Stored as 0 green .. 3 red.
const warnLevel = (c) => ({ 1: 3, 2: 2, 3: 1, 4: 0 }[c] ?? null);

async function warnings() {
  const props = ['District', 'Date', 'updated_at', ...[1, 2, 3, 4, 5].flatMap((n) => [`Day_${n}`, `Day${n}_Color`, `Day${n}_text`])];
  const base = `${IMD_OWS}&propertyName=${props.join(',')}`;
  const [tn, extra] = await Promise.all([
    get(`${base}&typename=imd:mcwise_district_warnings_view&CQL_FILTER=state_lgd=33`),
    // The Tamil Nadu view leaves out Mayiladuthurai.
    get(`${base}&typename=imd:district_warnings_india&CQL_FILTER=District='MAYILADUTHURAI'`),
  ]);
  const districts = {};
  let date = null, updatedAt = null;
  for (const { properties: p } of [...tn.features, ...extra.features]) {
    const name = districtOf(p.District);
    if (!name || districts[name]) continue;
    date ??= p.Date;
    // updated_at is labelled UTC but is actually IST.
    updatedAt ??= p.updated_at?.replace('Z', '+05:30');
    districts[name] = [1, 2, 3, 4, 5].map((n) => ({
      level: warnLevel(p[`Day${n}_Color`]),
      hazards: String(p[`Day_${n}`] ?? '').split(',').map((c) => HAZARDS[c.trim()]).filter((h) => h && h !== 'No warning'),
      text: p[`Day${n}_text`] || null,
    }));
  }
  if (Object.keys(districts).length < 30) throw new Error(`only ${Object.keys(districts).length} districts in warnings`);
  return { date, updatedAt, districts };
}

// ---------- IMD 3-hour nowcast ----------

async function nowcast() {
  const url = `${IMD_OWS}&typename=imd:NowcastWarningDistrict&CQL_FILTER=State='TAMILNADU'&propertyName=District,Date,toi,vupto,Color,message,update_time`;
  const json = await get(url);
  const districts = {};
  let issued = null;
  for (const { properties: p } of json.features) {
    const name = districtOf(p.District);
    if (!name) continue;
    issued ??= p.update_time ?? null;
    // Nowcast colours run the other way: 1 green .. 4 red.
    districts[name] = { level: p.Color ? p.Color - 1 : null, from: p.toi, to: p.vupto, date: p.Date, message: p.message || null };
  }
  return { issued, districts };
}

// ---------- IMD station rainfall, last 7 days ----------

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function locate(lon, lat, features) {
  for (const f of features) {
    for (const poly of f.geometry.coordinates) {
      // Even-odd across all rings handles holes.
      if (poly.reduce((acc, ring) => (inRing(lon, lat, ring) ? !acc : acc), false)) return f.properties.name;
    }
  }
  return null;
}

async function gauges() {
  const boundaries = JSON.parse(await readFile(BOUNDARIES, 'utf8')).features;
  const layers = await Promise.all([1, 2, 3, 4, 5, 6, 7].map((n) => get(
    `${DRMS_OWS}&typeName=IMD_Data:Rainfall_C${n === 1 ? '' : n}&CQL_FILTER=${encodeURIComponent(TN_BOX)}`,
  )));
  const log = await get('https://webgis.imd.gov.in/webgis_DRMS/script_run.log', { type: 'text' }).catch(() => '');
  const lastRun = log.trim().split('\n').reverse().find((l) => l.includes('SUCCESS'))?.split('|')[0] ?? null;

  const stations = new Map();
  layers.forEach((layer, k) => {
    for (const { properties: p } of layer.features) {
      const id = `${p.Station}|${p.lat}|${p.long}`;
      if (!stations.has(id)) {
        const district = locate(p.long, p.lat, boundaries);
        if (!district) continue; // outside Tamil Nadu
        stations.set(id, { name: p.Station, lat: p.lat, lon: p.long, district, mm: Array(7).fill(null) });
      }
      // Layer N holds the total over the last N days, so mm[0] is the last 24h and mm[6] the week.
      const v = p[`Rainfall${k + 1}`];
      stations.get(id).mm[k] = v == null ? null : Math.round(v * 10) / 10;
    }
  });
  const list = [...stations.values()];
  if (list.length < 100) throw new Error(`only ${list.length} Tamil Nadu stations`);
  // Rainfall1 is the 24 hours ending 08:30 IST on the day the job last ran.
  return { endDate: lastRun?.slice(0, 10) ?? null, updatedAt: lastRun, stations: list };
}

// ---------- IMD district rainfall: actual vs normal ----------

// msg D is the 24h ending 08:30 IST on `date`; msg M is month-to-date up to `date`.
async function districtRainfall(msg) {
  // The page sometimes comes back without its data, so check for it before accepting.
  const html = await get(`https://mausam.imd.gov.in/responsive/rainfallinformation.php?msg=${msg}`, {
    type: 'text',
    check: (h) => { if (!/"balloonText"/.test(h)) throw new Error(`rainfall msg=${msg} page has no district data`); },
  });
  const date = html.match(/Date\s*:\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  const districts = {};
  for (const m of html.matchAll(/"title":\s*"([^"]+)",\s*"id":\s*"\d+",[\s\S]*?"balloonText":\s*"([^"]*)"/g)) {
    const name = districtOf(m[1]);
    if (!name || districts[name]) continue;
    const text = m[2].replace(/\\\//g, '/');
    districts[name] = {
      actual: num(text.match(/Actual\s*:\s*(-?[\d.]+)/)?.[1]),
      normal: num(text.match(/Normal\s*:\s*(-?[\d.]+)/)?.[1]),
      departure: num(text.match(/Departure\s*:\s*(-?[\d.]+)/)?.[1]),
    };
  }
  if (Object.keys(districts).length < 30) throw new Error(`only ${Object.keys(districts).length} districts in rainfall msg=${msg}`);
  return { date, districts };
}

// ---------- NDMA Sachet CAP alerts (IMD Chennai nowcasts and SDMA warnings) ----------

async function alerts(previous = []) {
  const rss = await get('https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml', { type: 'text' });
  const items = [...rss.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1])
    .filter((i) => /IMD Chennai|Tamil Nadu|TN-SDMA|TNSDMA/i.test(i));
  const fresh = [];
  for (const item of items.slice(0, 20)) {
    const link = item.match(/<link>(.*?)<\/link>/)?.[1];
    if (!link) continue;
    const cap = await get(link, { type: 'text', tries: 1 }).catch(() => null);
    if (!cap) continue;
    const tag = (t) => cap.match(new RegExp(`<cap:${t}>([\\s\\S]*?)</cap:${t}>`))?.[1]?.trim() ?? null;
    if (!/Tamil Nadu/i.test(cap) && !/IMD Chennai/i.test(item)) continue;
    fresh.push({
      headline: stripTags(tag('headline') ?? item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''),
      event: tag('event'),
      severity: tag('severity'),
      effective: tag('effective'),
      expires: tag('expires'),
      sender: tag('sender'),
      link,
    });
  }
  // The feed holds only the latest 100 alerts for all of India, so keep earlier ones until they expire.
  const now = Date.now();
  const seen = new Set();
  return [...fresh, ...previous]
    .filter((a) => a.expires && Date.parse(a.expires) > now)
    .filter((a) => {
      const key = `${a.headline}|${a.effective}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => Date.parse(b.effective) - Date.parse(a.effective));
}

// ---------- Chennai water supply lakes (CMWSSB) ----------

async function lakes() {
  const html = await get('https://cmwssb.tn.gov.in/lake-level', { type: 'text' });
  const m = html.match(/Lake Storage As On\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) throw new Error('CMWSSB: "As On" date not found (page layout changed?)');
  const table = html.match(/<table[^>]*class="[^"]*lack-view[^"]*"[\s\S]*?<\/table>/);
  if (!table) throw new Error('CMWSSB: lake table not found');
  const rows = [...table[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((r) => [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => stripTags(c[1])))
    .filter((c) => c.length >= 10);
  const list = rows.map((c) => ({
    name: c[0].replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()),
    fullLevelFt: num(c[1]),
    capacityMcft: num(c[2]),
    levelFt: num(c[3]),
    storageMcft: num(c[4]),
    inflowCusecs: num(c[6]),
    outflowCusecs: num(c[7]),
    rainMm: num(c[8]),
    lastYearMcft: num(c[9]),
  }));
  if (list.length < 5) throw new Error(`CMWSSB: only ${list.length} rows parsed`);
  return { asOn: `${m[3]}-${m[2]}-${m[1]}`, lakes: list };
}

// ---------- Reservoir telemetry (TN WRD) ----------

const DAMS = {
  POONDI: 'Poondi', REDHILLS: 'Puzhal (Red Hills)', CHEMBARAMPAKKAM: 'Chembarambakkam', CHOLAVARAM: 'Cholavaram',
  'KANNANKOTTAI THERVOYKANDIGAI': 'Kannankottai Thervoy Kandigai', METTUR: 'Mettur', VAIGAI: 'Vaigai',
  BHAVANISAGAR: 'Bhavanisagar', 'LOWER BHAVANI': 'Bhavanisagar', AMARAVATHI: 'Amaravathi', PAPANASAM: 'Papanasam',
  PERIYAR: 'Periyar', SATHANUR: 'Sathanur', KRISHNAGIRI: 'Krishnagiri', 'PECHIPARAI': 'Pechiparai',
};

async function dams() {
  const rows = await get('https://wrd.tn.gov.in/wp-json/custom/v1/reservoir-data/', { insecure: true });
  const out = [];
  for (const r of rows) {
    const name = DAMS[String(r.ln).toUpperCase().trim()];
    if (!name || out.some((d) => d.name === name)) continue;
    const [d, mo, y, hms] = String(r.egt ?? '').split(/[/ ]/);
    // Some dam gauges stopped reporting months ago; skip anything older than a week.
    if (!y || Date.now() - Date.parse(`${y}-${mo}-${d}T00:00:00+05:30`) > 7 * 864e5) continue;
    out.push({
      name,
      storageMcft: r.tSt ?? null,
      capacityMcft: r.tca ?? null,
      depthFt: r.cl ?? null,
      fullDepthFt: r.frlh ?? null,
      observedAt: y ? `${y}-${mo}-${d}T${hms ?? '00:00:00'}+05:30` : null,
    });
  }
  if (!out.length) throw new Error('WRD: no known reservoirs in response');
  return out;
}

// ---------- run ----------

async function readPrevious() {
  try { return JSON.parse(await readFile(OUT, 'utf8')); } catch { /* no local copy */ }
  if (process.env.PREVIOUS_URL) {
    try { return await get(process.env.PREVIOUS_URL, { tries: 1 }); } catch { /* first deploy */ }
  }
  return {};
}

const prev = await readPrevious();
const out = { generatedAt: new Date().toISOString(), sources: {} };

const jobs = {
  warnings: () => warnings(),
  nowcast: () => nowcast(),
  gauges: () => gauges(),
  rainDaily: () => districtRainfall('D'),
  rainMonth: () => districtRainfall('M'),
  alerts: () => alerts(prev.alerts ?? []),
  lakes: () => lakes(),
  dams: () => dams(),
};

const results = await Promise.allSettled(Object.values(jobs).map((fn) => fn()));
let failures = 0;
Object.keys(jobs).forEach((key, k) => {
  const r = results[k];
  if (r.status === 'fulfilled') {
    out[key] = r.value;
    out.sources[key] = { ok: true, fetchedAt: out.generatedAt };
  } else {
    failures++;
    out[key] = prev[key] ?? null;
    out.sources[key] = { ok: false, error: String(r.reason?.message ?? r.reason), fetchedAt: prev.sources?.[key]?.fetchedAt ?? null };
    console.error(`[${key}] ${out.sources[key].error}`);
  }
});

await writeFile(OUT, JSON.stringify(out));
console.log(`Wrote ${OUT.pathname}: ${Object.keys(jobs).length - failures}/${Object.keys(jobs).length} sources fresh`);
for (const [k, s] of Object.entries(out.sources)) console.log(`  ${s.ok ? 'ok  ' : 'FAIL'} ${k}`);
// Fail the run only if nothing at all could be fetched.
if (failures === Object.keys(jobs).length) process.exit(1);
