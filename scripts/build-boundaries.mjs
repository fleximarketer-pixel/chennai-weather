// One-off: download IMD's district polygons for Tamil Nadu, simplify them and save
// data/tn-districts.geojson. Used for the warning map and to place rain gauges in districts.
import { writeFile } from 'node:fs/promises';
import { DISTRICTS, imdKey } from '../locations.js';

const SOURCE = 'https://reactjs.imd.gov.in/geoserver/ows?service=WFS&version=1.1.0&request=GetFeature'
  + '&typename=imd:district_warnings_india&outputFormat=application/json'
  + '&CQL_FILTER=BBOX(geom,8.0,76.2,13.6,80.4)&propertyName=District,geom';
const TOLERANCE = 0.004; // degrees, about 400 m

const byKey = new Map();
for (const d of DISTRICTS) for (const n of [d.name, ...(d.imd ?? [])]) byKey.set(imdKey(n), d.name);

// Douglas-Peucker on a closed ring.
function simplify(points) {
  if (points.length < 5) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a], [bx, by] = points[b];
    const len = Math.hypot(bx - ax, by - ay) || 1e-12;
    let max = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const d = Math.abs((by - ay) * px - (bx - ax) * py + bx * ay - by * ax) / len;
      if (d > max) [max, idx] = [d, i];
    }
    if (max > TOLERANCE) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const out = points.filter((_, i) => keep[i]).map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]);
  return out.length >= 4 ? out : points.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]);
}

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`IMD GeoServer returned ${res.status}`);
const src = await res.json();

const features = src.features
  .filter((f) => byKey.has(imdKey(f.properties.District)))
  .map((f) => ({
    type: 'Feature',
    properties: { name: byKey.get(imdKey(f.properties.District)) },
    geometry: {
      type: 'MultiPolygon',
      coordinates: (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates)
        .map((poly) => poly.map(simplify)),
    },
  }));

const missing = DISTRICTS.filter((d) => !features.some((f) => f.properties.name === d.name)).map((d) => d.name);
if (missing.length) throw new Error(`No boundary for: ${missing.join(', ')}`);

const out = new URL('../data/tn-districts.geojson', import.meta.url);
await writeFile(out, JSON.stringify({ type: 'FeatureCollection', features }));
console.log(`Wrote ${features.length} districts to ${out.pathname}`);
