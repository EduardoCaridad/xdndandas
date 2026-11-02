// Cliente mínimo para la API de Transitous (MOTIS 2).
import { CONFIG } from './config.js';
import { distanceKm } from './geo.js';

// Modos de MOTIS que se piden para cada opción del usuario (sin modos obsoletos:
// REGIONAL_FAST_RAIL, METRO… pueden hacer que el servidor rechace la búsqueda).
export const MODE_GROUPS = {
  train: ['HIGHSPEED_RAIL', 'LONG_DISTANCE', 'NIGHT_RAIL', 'REGIONAL_RAIL', 'SUBURBAN'],
  bus: ['BUS', 'COACH'],
  plane: ['AIRPLANE'],
};
// Cómo se clasifica cada tramo que devuelve la API.
const CATEGORY = {
  HIGHSPEED_RAIL: 'train', LONG_DISTANCE: 'train', NIGHT_RAIL: 'train', REGIONAL_FAST_RAIL: 'train',
  REGIONAL_RAIL: 'train', RAIL: 'train', SUBURBAN: 'train',
  BUS: 'bus', COACH: 'bus',
  AIRPLANE: 'plane', FERRY: 'ferry',
  SUBWAY: 'urban', METRO: 'urban', TRAM: 'urban', FUNICULAR: 'urban', AERIAL_LIFT: 'urban', CABLE_CAR: 'urban',
};
const NON_TRANSIT = new Set(['WALK', 'BIKE', 'RENTAL', 'CAR', 'CAR_PARKING', 'CAR_DROPOFF', 'ODM', 'FLEX', 'RIDE_SHARING', 'HGV']);

export const modeCategory = (mode) => CATEGORY[mode] || 'other';
export const isTransitLeg = (leg) => !NON_TRANSIT.has(leg.mode);

let workingVersion = null;

function qs(params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    u.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  return u.toString();
}

async function getJson(url, signal) {
  const r = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!r.ok) {
    const err = new Error(`Transitous respondió ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

/** Llama a un endpoint versionado probando las versiones configuradas. */
async function versioned(path, params, signal) {
  const versions = workingVersion ? [workingVersion] : CONFIG.transitousVersions;
  let lastErr;
  for (const v of versions) {
    try {
      const data = await getJson(`${CONFIG.transitousBase}/api/${v}/${path}?${qs(params)}`, signal);
      workingVersion = v;
      return data;
    } catch (e) {
      lastErr = e;
      if (e.name === 'AbortError') throw e;
      if (e.status && e.status !== 404 && e.status !== 400) throw e;
    }
  }
  throw lastErr;
}

/** Autocompletado de lugares y estaciones. */
export async function geocode(text, signal) {
  const lang = (navigator.language || 'es').slice(0, 2);
  const res = await getJson(
    `${CONFIG.transitousBase}/api/v1/geocode?${qs({ text, language: lang })}`,
    signal,
  );
  return res
    .filter((m) => m.type === 'STOP' || m.type === 'PLACE')
    .slice(0, 8)
    .map((m) => ({
      id: m.id,
      type: m.type,
      name: m.name,
      lat: m.lat,
      lon: m.lon,
      area: (m.areas || []).filter((a) => !a.matched || a.default).map((a) => a.name).slice(0, 2).join(', '),
      country: m.country || '',
    }));
}

/** Convierte una selección del autocompletado en el parámetro fromPlace/toPlace. */
export function placeParam(p) {
  return p.type === 'STOP' && p.id ? p.id : `${p.lat},${p.lon}`;
}

/**
 * Busca todas las conexiones de un día.
 * @param {object} o {from, to, timeStart: Date, windowSec, modes: string[] (train/bus/plane), directOnly}
 */
export async function planDay(o, signal, pageCursor) {
  const transitModes = o.modes.length ? o.modes.flatMap((m) => MODE_GROUPS[m]) : undefined;
  const walk = (o.walkMinutes || CONFIG.maxWalkMinutes) * 60;
  const params = {
    fromPlace: placeParam(o.from),
    toPlace: placeParam(o.to),
    time: (o.timeStart || o.dayStart).toISOString(),
    arriveBy: false,
    timetableView: true,
    searchWindow: o.windowSec || 24 * 3600,
    numItineraries: 60,
    maxTransfers: o.directOnly ? 0 : undefined,
    transitModes,
    directModes: 'WALK',
    preTransitModes: 'WALK',
    postTransitModes: 'WALK',
    maxPreTransitTime: o.from.type === 'STOP' ? undefined : walk,
    maxPostTransitTime: o.to.type === 'STOP' ? undefined : walk,
    detailedTransfers: false,
    language: (navigator.language || 'es').slice(0, 2),
    pageCursor,
  };
  return versioned('plan', params, signal);
}

const STATION_WORDS = /estaci|station|terminal|intermodal|autobuses|bus station|gare|bahnhof|stazione|esta[cç][aã]o/i;
const MAIN_RAIL = ['HIGHSPEED_RAIL', 'LONG_DISTANCE', 'NIGHT_RAIL', 'REGIONAL_RAIL', 'RAIL'];
const stationCache = new Map();

/**
 * Estaciones de tren y de autobús de una ciudad: { train: [...], bus: [...] },
 * ordenadas de más a menos importante.
 */
export async function cityStations(place, signal) {
  const ck = `${place.lat.toFixed(3)},${place.lon.toFixed(3)}`;
  if (stationCache.has(ck)) return stationCache.get(ck);
  const lang = (navigator.language || 'es').slice(0, 2);
  const city = place.name.split(',')[0];
  const ask = (text, group) => getJson(`${CONFIG.transitousBase}/api/v1/geocode?${qs({
    text, type: 'STOP', mode: MODE_GROUPS[group], place: `${place.lat},${place.lon}`, placeBias: 5, numResults: 20, language: lang,
  })}`, signal).catch((e) => { if (e.name === 'AbortError') throw e; return []; });

  const out = {};
  for (const group of ['train', 'bus']) {
    const lists = await Promise.all([ask(city, group), ask(`${group === 'train' ? 'estación' : 'estación de autobuses'} ${city}`, group)]);
    const byName = new Map();
    for (const m of lists.flat()) {
      if (m.type !== 'STOP') continue;
      const d = distanceKm(place, m);
      if (d > 15) continue;
      // Si la API dice qué medios paran ahí, solo valen las del medio pedido.
      if (m.modes && !m.modes.some((x) => modeCategory(x) === group)) continue;
      let score = m.importance ?? 0;
      if (group === 'train' && m.modes?.some((x) => MAIN_RAIL.includes(x))) score += 0.3;
      if (group === 'bus' && m.modes?.includes('COACH')) score += 0.3;
      if (STATION_WORDS.test(m.name)) score += 0.2;
      score -= d / 100; // a igualdad, la más céntrica
      const prev = byName.get(m.name);
      if (!prev || prev.score < score) byName.set(m.name, { type: 'STOP', id: m.id, name: m.name, lat: m.lat, lon: m.lon, group, score, distKm: d });
    }
    const sorted = [...byName.values()].sort((a, b) => b.score - a.score);
    // Fuera las paradas poco relevantes (paradas urbanas, apeaderos) comparadas con la principal.
    out[group] = sorted.filter((x, i) => i === 0 || x.score >= sorted[0].score * 0.3).slice(0, 6);
  }
  stationCache.set(ck, out);
  return out;
}

/**
 * Estaciones desde las que buscar un medio. Si el usuario eligió estaciones de ese medio,
 * esas; si no («Todas»), las 3 principales de la ciudad.
 */
export async function stationsFor(place, group, chosen = [], signal) {
  if (place.type === 'STOP' && place.id) return [place];
  const all = (await cityStations(place, signal))[group] || [];
  const picked = all.filter((s) => chosen.includes(s.id));
  if (picked.length) return picked;
  if (!all.length) return [];
  // Solo las que tengan cierta importancia comparada con la principal (evita apeaderos).
  return all.filter((s, i) => i === 0 || s.score >= all[0].score * 0.4).slice(0, 3);
}

/** ¿Todos los tramos en vehículo de este itinerario son del medio pedido? */
export const onlyGroup = (it, group) => it.legs.filter(isTransitLeg).every((l) => modeCategory(l.mode) === group);

/**
 * Busca solo trenes o solo autobuses entre dos sitios. Nunca mezcla medios:
 * se pide a la API solo ese medio, desde las estaciones de ese medio, y se descarta
 * cualquier itinerario que traiga otro.
 */
export async function planGroup(o, group, signal) {
  const base = { ...o, modes: [group] };
  const [froms, tos] = await Promise.all([
    stationsFor(o.from, group, o.fromChoice, signal).catch((e) => { if (e.name === 'AbortError') throw e; return []; }),
    stationsFor(o.to, group, o.toChoice, signal).catch((e) => { if (e.name === 'AbortError') throw e; return []; }),
  ]);
  const pairs = [];
  for (const f of froms) for (const t of tos) pairs.push([f, t]);
  let itineraries = [];
  let errors = 0;
  if (pairs.length) {
    // Como mucho 3 búsquedas a la vez, para no cargar el servicio comunitario.
    const res = [];
    for (let i = 0; i < pairs.length; i += 3) {
      res.push(...await Promise.allSettled(pairs.slice(i, i + 3).map(([f, t]) => planDay({ ...base, from: f, to: t }, signal))));
    }
    for (const r of res) {
      if (r.status === 'fulfilled') itineraries.push(...(r.value.itineraries || []));
      else if (r.reason?.name === 'AbortError') throw r.reason;
      else errors++;
    }
  }
  // Si no se encontraron estaciones (o no salió nada), se busca desde el centro de la ciudad
  // andando un poco más hasta la estación.
  if (!itineraries.length) {
    try {
      const r = await planDay({ ...base, walkMinutes: 60 }, signal);
      itineraries = r.itineraries || [];
    } catch (e) {
      if (e.name === 'AbortError' || errors === pairs.length) throw e;
    }
  }
  return {
    itineraries: itineraries.filter((it) => onlyGroup(it, group) && it.legs.some(isTransitLeg)),
    stations: { from: froms.map((s) => s.name), to: tos.map((s) => s.name) },
  };
}

/** Datos actualizados (tiempo real) de un viaje completo. */
export async function getTrip(tripId, signal) {
  return versioned('trip', { tripId, language: (navigator.language || 'es').slice(0, 2) }, signal);
}

/** Texto corto para identificar un tramo: "AVE 03123", "Línea 4 → Lugo"... */
export function legTitle(leg) {
  const name = leg.displayName || [leg.category?.shortName, leg.tripShortName || leg.routeShortName].filter(Boolean).join(' ') || leg.routeLongName || leg.mode;
  return name.trim();
}
