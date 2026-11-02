// Vuelos programados (próximas horas) con la API de AirLabs.
// Plan gratuito (uso personal): https://airlabs.co — cada usuario usa su propia clave gratuita,
// que se guarda solo en su dispositivo.
import { CONFIG, isNativeApp, resolveAdsbProxy } from './config.js';
import { airlineInfo } from './flights.js';

const KEY_STORE = 'airlabs-key';
const LIVE_TTL = 5 * 60 * 1000;            // horarios en vivo: 5 min de caché
const ROUTES_TTL = 7 * 24 * 3600 * 1000;   // rutas habituales: 7 días de caché

export function getAirlabsKey() {
  try { return localStorage.getItem(KEY_STORE) || CONFIG.airlabsKey || ''; } catch { return CONFIG.airlabsKey || ''; }
}
export function setAirlabsKey(k) {
  try { k ? localStorage.setItem(KEY_STORE, k.trim()) : localStorage.removeItem(KEY_STORE); } catch { /* sin almacenamiento */ }
}

/** Dónde llamar a AirLabs: directo desde la app nativa, o por el proxy si lo hay. */
async function base() {
  if (isNativeApp()) return 'https://airlabs.co';
  const p = await resolveAdsbProxy();
  if (p && p.endsWith('/adsb')) return p.replace(/\/adsb$/, '/airlabs');
  return 'https://airlabs.co';
}

function cacheGet(k) {
  try { const v = JSON.parse(localStorage.getItem(k)); return v && v.exp > Date.now() ? v.data : null; } catch { return null; }
}
function cacheSet(k, data, ttl) {
  try { localStorage.setItem(k, JSON.stringify({ exp: Date.now() + ttl, data })); } catch { /* lleno o no disponible */ }
}

const ERRORS = {
  wrong_params: 'parámetros incorrectos',
  unknown_api_key: 'la clave de AirLabs no es válida',
  expired_api_key: 'la clave de AirLabs ha caducado',
  month_limit_exceeded: 'se ha agotado la cuota gratuita de este mes',
  minute_limit_exceeded: 'demasiadas consultas seguidas; espera un minuto',
  not_found: 'sin datos',
};

async function call(path, params, ttl, signal) {
  const key = getAirlabsKey();
  if (!key) { const e = new Error('Falta la clave gratuita de AirLabs'); e.code = 'no_key'; throw e; }
  const ck = `al:${path}:${JSON.stringify(params)}`;
  const cached = cacheGet(ck);
  if (cached) return cached;
  const qs = new URLSearchParams({ ...params, api_key: key }).toString();
  let r;
  try {
    r = await fetch(`${await base()}/api/v9/${path}?${qs}`, { signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    const err = new Error('no se pudo contactar con AirLabs (en la versión web hace falta el proxy; en la app de Android funciona directo)');
    err.code = 'network';
    throw err;
  }
  const j = await r.json().catch(() => ({}));
  if (j.error) {
    if (j.error.code === 'not_found') { cacheSet(ck, [], ttl); return []; }
    const e = new Error(ERRORS[j.error.code] || j.error.message || 'error de AirLabs');
    e.code = j.error.code;
    throw e;
  }
  const data = Array.isArray(j.response) ? j.response : [];
  cacheSet(ck, data, ttl);
  return data;
}

// --- Horas ---------------------------------------------------------------

const utc = (s) => (s ? Date.parse(String(s).replace(' ', 'T') + 'Z') : NaN);
const local = (s) => (s ? Date.parse(String(s).replace(' ', 'T')) : NaN);
const first = (...v) => v.find((x) => Number.isFinite(x)) ?? null;

/** Horas programada / real (estimada o efectiva) de salida o llegada. */
export function sideTimes(f, side) {
  const sched = first(f[`${side}_time_ts`] * 1000, utc(f[`${side}_time_utc`]), local(f[`${side}_time`]));
  const actual = first(f[`${side}_actual_ts`] * 1000, utc(f[`${side}_actual_utc`]), local(f[`${side}_actual`]));
  const est = first(f[`${side}_estimated_ts`] * 1000, utc(f[`${side}_estimated_utc`]), local(f[`${side}_estimated`]));
  return { sched, real: actual ?? est ?? sched, actual: actual != null };
}

const STATUS = { scheduled: 'Programado', active: 'En vuelo', 'en-route': 'En vuelo', landed: 'Aterrizado', cancelled: 'Cancelado', diverted: 'Desviado', incident: 'Incidencia' };

function airlineOf(f) {
  const info = airlineInfo(f.airline_icao) || airlineInfo(f.airline_iata);
  return {
    airlineIata: f.airline_iata || info?.iata || '',
    airlineIcao: f.airline_icao || info?.icao || '',
    airline: info?.name || '',
  };
}

/** Convierte un registro de /schedules en un vuelo de la app. */
export function fromSchedule(f, origin, dest) {
  const dep = sideTimes(f, 'dep');
  const arr = sideTimes(f, 'arr');
  if (arr.sched == null && dep.sched != null && f.duration) {
    arr.sched = dep.sched + f.duration * 60000;
    arr.real = (dep.real ?? dep.sched) + f.duration * 60000;
  }
  // Si sale con retraso y no hay llegada estimada, la llegada se retrasa lo mismo.
  if (arr.sched != null && arr.real === arr.sched && dep.real != null && dep.sched != null && dep.real > dep.sched) {
    arr.real = arr.sched + (dep.real - dep.sched);
  }
  const a = airlineOf(f);
  const number = String(f.flight_number || (f.flight_iata || '').replace(/^[A-Z0-9]{2}/, '') || '');
  return {
    kind: 'sched',
    id: `${f.flight_iata || a.airlineIata + number}@${dep.sched}`,
    flightIata: f.flight_iata || `${a.airlineIata}${number}`,
    flightIcao: f.flight_icao || (a.airlineIcao ? `${a.airlineIcao}${number}` : ''),
    number, ...a,
    origin, dest, dep, arr,
    status: f.status || 'scheduled',
    statusText: STATUS[f.status] || 'Programado',
    depTerminal: f.dep_terminal || '', depGate: f.dep_gate || '', arrTerminal: f.arr_terminal || '',
    delayMin: first(f.dep_delayed, f.delayed) ?? (dep.real != null && dep.sched != null ? Math.round((dep.real - dep.sched) / 60000) : 0),
    aircraft: f.aircraft_icao || '',
    usual: false,
  };
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * Convierte una ruta habitual (/routes: días de la semana + hora) en las salidas
 * que caen dentro de [from, to).
 */
export function routeOccurrences(r, origin, dest, from, to) {
  const hm = r.dep_time_utc || r.dep_time;
  if (!hm || !/^\d{1,2}:\d{2}/.test(hm)) return [];
  const [h, m] = hm.split(':').map(Number);
  const isUtc = !!r.dep_time_utc;
  const days = (r.days || []).map((d) => String(d).toLowerCase().slice(0, 3));
  const out = [];
  const d0 = new Date(from); d0.setUTCHours(0, 0, 0, 0); d0.setUTCDate(d0.getUTCDate() - 1);
  for (let d = new Date(d0); d.getTime() < to + 86400000; d.setUTCDate(d.getUTCDate() + 1)) {
    const t = isUtc
      ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m)
      : new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m).getTime();
    if (t < from || t >= to) continue;
    const wd = DAYS[(isUtc ? new Date(t).getUTCDay() : new Date(t).getDay())];
    if (days.length && !days.includes(wd)) continue;
    const dur = (r.duration || 0) * 60000;
    const a = airlineOf(r);
    const number = String(r.flight_number || (r.flight_iata || '').replace(/^[A-Z0-9]{2}/, '') || '');
    out.push({
      kind: 'sched', usual: true,
      id: `${r.flight_iata}@${t}`,
      flightIata: r.flight_iata || `${a.airlineIata}${number}`,
      flightIcao: r.flight_icao || (a.airlineIcao ? `${a.airlineIcao}${number}` : ''),
      number, ...a, origin, dest,
      dep: { sched: t, real: t, actual: false },
      arr: { sched: dur ? t + dur : null, real: dur ? t + dur : null, actual: false },
      status: 'scheduled', statusText: 'Horario habitual',
      depTerminal: (r.dep_terminals || [])[0] || '', depGate: '', arrTerminal: (r.arr_terminals || [])[0] || '',
      delayMin: 0, aircraft: r.aircraft_icao || '',
    });
  }
  return out;
}

/**
 * Vuelos programados entre los aeropuertos de origen y destino en [from, to).
 * Usa los horarios en vivo (≈ próximas 10 h, con retrasos) y completa el resto
 * con las rutas habituales, si el plan de la clave las incluye.
 */
export async function scheduledFlights(origins, dests, from, to, signal) {
  const pairs = [];
  for (const o of origins.slice(0, 2)) for (const d of dests.slice(0, 2)) if (o.iata !== d.iata) pairs.push([o, d]);
  const found = new Map();
  const warnings = [];
  let liveUntil = Date.now();

  for (const [o, d] of pairs) {
    const live = await call('schedules', { dep_iata: o.iata, arr_iata: d.iata }, LIVE_TTL, signal);
    for (const f of live) {
      if (f.cs_flight_iata) continue; // código compartido: ya sale con la aerolínea que opera
      const v = fromSchedule(f, o, d);
      if (v.dep.sched == null) continue;
      liveUntil = Math.max(liveUntil, v.dep.sched);
      if (v.dep.real < to && (v.arr.real ?? v.dep.real) >= from) found.set(v.id, v);
    }
  }

  // Más allá de lo que cubren los horarios en vivo: rutas habituales.
  if (to > liveUntil + 30 * 60000) {
    for (const [o, d] of pairs) {
      try {
        const routes = await call('routes', { dep_iata: o.iata, arr_iata: d.iata }, ROUTES_TTL, signal);
        const start = Math.max(from, liveUntil + 60000);
        for (const r of routes) {
          if (r.cs_flight_iata) continue;
          for (const v of routeOccurrences(r, o, d, start, to)) {
            const dup = [...found.values()].some((x) => x.flightIata === v.flightIata && Math.abs(x.dep.sched - v.dep.sched) < 3 * 3600000);
            if (!dup) found.set(v.id, v);
          }
        }
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        warnings.push(e.message);
      }
    }
  }
  return { flights: [...found.values()].sort((a, b) => a.dep.real - b.dep.real), liveUntil, warnings };
}

/** ¿Este avión en el aire (ADS-B) es este vuelo programado? */
export function matchesLive(sched, live) {
  const n = (x) => String(x || '').replace(/^0+/, '');
  const num = n(sched.number);
  if (!num) return false;
  if (live.routeAirline && live.routeNumber != null && (live.routeAirline === sched.airlineIcao || live.routeAirline === sched.airlineIata)) {
    return n(live.routeNumber) === num;
  }
  const cs = (live.callsign || '').toUpperCase();
  const m = cs.match(/^([A-Z]{3})0*(\d+[A-Z]?)$/);
  return !!m && m[1] === sched.airlineIcao && m[2] === num;
}
