// Builds BikeSIM's real Oaxaca roads from OpenStreetMap routing and SRTM-derived terrain.
// Runs once inside the devcontainer with network access; the app then works offline.
//   node scripts/build-routes.mjs [route-id ...]
// Road geometry: © OpenStreetMap contributors (ODbL), routed by the public OSRM service.
// Elevation: Mapzen/Tilezen Terrain Tiles on AWS Open Data (SRTM and other public sources).
import fs from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

const userAgent = 'BikeSIM route builder (personal, non-commercial)';
const cacheDir = '.cache/terrain';
const publicDir = 'public/routes';
const dataDir = 'src/ride/routes';
const pathStep = 10;
const profileStep = 20;
const attribution =
  'Road © OpenStreetMap contributors (ODbL), routed with OSRM. Elevation: Mapzen Terrain Tiles on AWS (SRTM, NASA).';

export const catalog = [
  {
    id: 'monte-alban',
    name: 'Monte Albán',
    description:
      'From the Zócalo across the city and up the winding highway to the Zapotec city above the valley.',
    kind: 'Classic climb',
    // Via the modern Carretera Ramal from the north, not the steep old road up the east face.
    waypoints: [
      [17.0606, -96.72534],
      [17.07361, -96.76441],
      [17.0444, -96.7662],
    ],
  },
  {
    id: 'san-felipe',
    name: 'San Felipe del Agua',
    description:
      'North from El Llano up the calzada into the foothills of the Sierra Norte, to the village at 1,700 m.',
    kind: 'Steady climb',
    waypoints: [
      [17.06823, -96.71961],
      [17.10875, -96.71144],
    ],
  },
  {
    id: 'tule-mitla',
    name: 'El Tule to Mitla',
    description:
      'The long valley road east past Tlacolula to Mitla. Gentle grades for steady endurance miles.',
    kind: 'Valley endurance',
    waypoints: [
      [17.04647, -96.63616],
      [16.92729, -96.3596],
    ],
  },
  {
    id: 'teotitlan',
    name: 'Teotitlán del Valle',
    description:
      'Off the Mitla highway toward the weaving village under the sierra. A short, gentle rise.',
    kind: 'Gentle rise',
    waypoints: [
      [17.0003, -96.5134],
      [17.0305, -96.5207],
    ],
  },
];

// ---------------------------------------------------------------------------- helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const earth = { lat: 110574, lon: 111320 };
function projector([lat0, lon0]) {
  const k = Math.cos((lat0 * Math.PI) / 180);
  return {
    toLocal: (lat, lon) => [(lon - lon0) * earth.lon * k, -(lat - lat0) * earth.lat],
    toLatLon: (x, z) => [lat0 - z / earth.lat, lon0 + x / (earth.lon * k)],
  };
}
async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': userAgent } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

/** Terrarium tiles: height = R·256 + G + B/256 − 32768 meters. */
const tiles = new Map();
async function tile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (tiles.has(key)) return tiles.get(key);
  const file = path.join(cacheDir, `${z}-${x}-${y}.png`);
  let bytes;
  try {
    bytes = await fs.readFile(file);
  } catch {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
    const res = await fetch(url, { headers: { 'User-Agent': userAgent } });
    if (!res.ok) throw new Error(`terrain ${res.status} ${url}`);
    bytes = Buffer.from(await res.arrayBuffer());
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(file, bytes);
    await sleep(40);
  }
  const png = PNG.sync.read(bytes);
  const heights = new Float32Array(256 * 256);
  for (let i = 0; i < heights.length; i++)
    heights[i] = png.data[i * 4] * 256 + png.data[i * 4 + 1] + png.data[i * 4 + 2] / 256 - 32768;
  tiles.set(key, heights);
  return heights;
}
async function elevation(lat, lon, z) {
  const n = 2 ** z;
  const fx = ((lon + 180) / 360) * n * 256;
  const r = (lat * Math.PI) / 180;
  const fy = ((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * n * 256;
  const px = Math.floor(fx - 0.5),
    py = Math.floor(fy - 0.5);
  const u = fx - 0.5 - px,
    v = fy - 0.5 - py;
  const pixel = async (gx, gy) => {
    const t = await tile(z, Math.floor(gx / 256), Math.floor(gy / 256));
    return t[(gy & 255) * 256 + (gx & 255)];
  };
  const [a, b, c, d] = await Promise.all([
    pixel(px, py),
    pixel(px + 1, py),
    pixel(px, py + 1),
    pixel(px + 1, py + 1),
  ]);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

function resample(points, step) {
  const out = [points[0]];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1],
      [bx, bz] = points[i];
    const len = Math.hypot(bx - ax, bz - az);
    let t = step - carry;
    while (t <= len) {
      out.push([ax + ((bx - ax) * t) / len, az + ((bz - az) * t) / len]);
      t += step;
    }
    carry = len - (t - step);
  }
  return out;
}
const median = (values, radius) =>
  values.map((_, i) => {
    const w = values.slice(Math.max(0, i - radius), i + radius + 1).sort((a, b) => a - b);
    return w[w.length >> 1];
  });
function gaussian(values, sigma) {
  const radius = Math.ceil(sigma * 3);
  const weights = Array.from({ length: radius * 2 + 1 }, (_, k) =>
    Math.exp(-((k - radius) ** 2) / (2 * sigma * sigma)),
  );
  return values.map((_, i) => {
    let sum = 0,
      total = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = Math.min(values.length - 1, Math.max(0, i + k));
      sum += values[j] * weights[k + radius];
      total += weights[k + radius];
    }
    return sum / total;
  });
}

/**
 * Cap sustained grade: a DEM sees the hillside at switchbacks, so its road profile overstates
 * ramps. Forward and backward passes each rise at most `cap`; their average keeps both ends and
 * the total climb while staying under the cap.
 */
function limitGrades(h, step, cap) {
  const d = (cap / 100) * step;
  const f = [...h],
    b = [...h];
  for (let i = 1; i < f.length; i++) f[i] = Math.min(f[i - 1] + d, Math.max(f[i - 1] - d, h[i]));
  for (let i = b.length - 2; i >= 0; i--)
    b[i] = Math.min(b[i + 1] + d, Math.max(b[i + 1] - d, h[i]));
  return f.map((v, i) => (v + b[i]) / 2);
}

async function grid(project, bounds, spacing, zoom, file) {
  const columns = Math.ceil((bounds.x1 - bounds.x0) / spacing) + 1,
    rows = Math.ceil((bounds.z1 - bounds.z0) / spacing) + 1;
  const heights = new Float32Array(columns * rows);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < columns; i++) {
      const [lat, lon] = project.toLatLon(bounds.x0 + i * spacing, bounds.z0 + j * spacing);
      heights[j * columns + i] = await elevation(lat, lon, zoom);
    }
  let lo = Infinity;
  for (const h of heights) lo = Math.min(lo, h);
  const offset = Math.floor(lo) - 20,
    scale = 0.1;
  const packed = new Uint16Array(heights.length);
  heights.forEach(
    (h, i) => (packed[i] = Math.max(0, Math.min(65535, Math.round((h - offset) / scale)))),
  );
  await fs.writeFile(path.join(publicDir, file), Buffer.from(packed.buffer));
  return { file, x0: bounds.x0, z0: bounds.z0, spacing, columns, rows, offset, scale };
}

// ---------------------------------------------------------------------------- build
async function build(def) {
  const coords = def.waypoints.map(([lat, lon]) => `${lon},${lat}`).join(';');
  const osrm = await getJson(
    `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&continue_straight=true`,
  );
  const line = osrm.routes[0].geometry.coordinates.map(([lon, lat]) => [lat, lon]);
  const project = projector(line[0]);
  const local = line.map(([lat, lon]) => project.toLocal(lat, lon));
  // Drop duplicate nodes, resample every 10 m, and ease out digitizing kinks.
  const dense = resample(
    local.filter(
      (p, i) => i === 0 || Math.hypot(p[0] - local[i - 1][0], p[1] - local[i - 1][1]) > 0.5,
    ),
    pathStep,
  );
  const smooth = dense.map((p, i) =>
    i === 0 || i === dense.length - 1
      ? p
      : [0, 1].map((k) => (dense[i - 1][k] + 2 * p[k] + dense[i + 1][k]) / 4),
  );
  const length = Math.floor(((smooth.length - 1) * pathStep) / profileStep) * profileStep;
  const pathPoints = smooth.slice(0, length / pathStep + 1);
  // Road elevation: SRTM is noisy on hillsides, so median-filter spikes, then smooth ~60 m.
  const raw = [];
  for (const [x, z] of pathPoints) raw.push(await elevation(...project.toLatLon(x, z), 14));
  const heights = gaussian(limitGrades(gaussian(median(raw, 3), 6), pathStep, def.cap ?? 14), 2);
  const perProfile = profileStep / pathStep;
  const profile = [];
  for (let m = 0; m <= length; m += profileStep) {
    const i = m / pathStep;
    const before = heights[Math.max(0, i - perProfile)],
      after = heights[Math.min(heights.length - 1, i + perProfile)];
    const span =
      (Math.min(heights.length - 1, i + perProfile) - Math.max(0, i - perProfile)) * pathStep;
    const grade = Math.max(-18, Math.min(18, ((after - before) / span) * 100));
    profile.push({ meters: m, grade: Math.round(grade * 100) / 100 });
  }
  let gain = 0,
    maxGrade = 0;
  for (let i = 1; i < heights.length; i++) gain += Math.max(0, heights[i] - heights[i - 1]);
  for (let i = 10; i < heights.length; i++)
    maxGrade = Math.max(maxGrade, ((heights[i] - heights[i - 10]) / 100) * 100);
  const xs = pathPoints.map((p) => p[0]),
    zs = pathPoints.map((p) => p[1]);
  const box = (margin) => ({
    x0: Math.floor((Math.min(...xs) - margin) / 10) * 10,
    x1: Math.ceil((Math.max(...xs) + margin) / 10) * 10,
    z0: Math.floor((Math.min(...zs) - margin) / 10) * 10,
    z1: Math.ceil((Math.max(...zs) + margin) / 10) * 10,
  });
  await fs.mkdir(publicDir, { recursive: true });
  const near = await grid(project, box(2200), 25, 14, `${def.id}-near.bin`);
  const far = await grid(project, box(17000), 160, 11, `${def.id}-far.bin`);
  const route = {
    id: def.id,
    name: def.name,
    description: def.description,
    kind: def.kind,
    region: 'Oaxaca, México',
    attribution,
    origin: { lat: line[0][0], lon: line[0][1] },
    startElevation: Math.round(heights[0] * 10) / 10,
    points: profile,
    path: pathPoints.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]),
    pathStep,
    terrain: { near, far },
    summary: {
      km: Math.round(length / 100) / 10,
      gain: Math.round(gain),
      top: Math.round(Math.max(...heights)),
      maxGrade: Math.round(maxGrade * 10) / 10,
    },
  };
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, `${def.id}.json`), JSON.stringify(route));
  console.log(
    `${def.id}: ${route.summary.km} km, +${route.summary.gain} m, ${Math.round(heights[0])}→${Math.round(heights.at(-1))} m, max ${route.summary.maxGrade}% over 100 m, ${pathPoints.length} path points`,
  );
}

const only = process.argv.slice(2);
for (const def of catalog.filter((d) => !only.length || only.includes(d.id))) await build(def);
