// Vuelos en directo con datos ADS-B abiertos (adsb.lol, licencia ODbL) y OpenSky como respaldo.
import { CONFIG } from './config.js';
import { distanceKm, greatCirclePoint, bearingDeg, angleDiff } from './geo.js';

const KNOT_KMH = 1.852;
let airportsCache = null;

/** Carga la base de aeropuertos (OurAirports, dominio público). */
export async function loadAirports() {
  if (airportsCache) return airportsCache;
  const r = await fetch(new URL('../data/airports.json', import.meta.url).href);
  const j = await r.json();
  airportsCache = j.airports.map(([iata, icao, name, municipality, country, lat, lon, keywords]) => ({
    iata, icao, name, city: municipality, municipality, country, lat, lon, keywords,
  }));
  return airportsCache;
}

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Aeropuertos de una ciudad: por cercanía a sus coordenadas y por coincidencia de texto. */
export async function airportsFor(place, radiusKm = CONFIG.airportRadiusKm) {
  const list = await loadAirports();
  const q = norm(place.name.split(',')[0]);
  const found = new Map();
  for (const a of list) {
    const d = distanceKm(place, a);
    const textHit = q.length >= 3 && (a.iata.toLowerCase() === q || norm(a.city) === q || norm(a.municipality) === q || norm(a.name).includes(q) || norm(a.keywords).includes(q));
    if (d <= radiusKm || (textHit && d <= 250)) {
      // Si el aeropuerto no lleva el nombre de su municipio (A Coruña está en Culleredo,
      // JFK en Nueva York), se muestra la ciudad que ha buscado el usuario.
      const muniInName = a.municipality && norm(a.name).includes(norm(a.municipality).split(/[ ,/-]/)[0]);
      const city = muniInName || !place.name ? a.municipality : place.name.split(',')[0];
      found.set(a.iata, { ...a, city, distKm: d });
    }
  }
  return [...found.values()].sort((a, b) => a.distKm - b.distKm).slice(0, 4);
}

// Algunas aerolíneas frecuentes: [código OACI (indicativo), código IATA, nombre].
const AIRLINE_LIST = [
  ['IBE', 'IB', 'Iberia'], ['IBS', 'I2', 'Iberia Express'], ['ANE', 'YW', 'Air Nostrum'], ['VLG', 'VY', 'Vueling'],
  ['AEA', 'UX', 'Air Europa'], ['RYR', 'FR', 'Ryanair'], ['EZY', 'U2', 'easyJet'], ['EJU', 'EC', 'easyJet Europe'],
  ['BAW', 'BA', 'British Airways'], ['AFR', 'AF', 'Air France'], ['DLH', 'LH', 'Lufthansa'], ['KLM', 'KL', 'KLM'],
  ['TAP', 'TP', 'TAP Air Portugal'], ['SWR', 'LX', 'Swiss'], ['ITY', 'AZ', 'ITA Airways'], ['BEL', 'SN', 'Brussels Airlines'],
  ['VOE', 'V7', 'Volotea'], ['BTI', 'BT', 'airBaltic'], ['UAE', 'EK', 'Emirates'], ['QTR', 'QR', 'Qatar Airways'],
  ['THY', 'TK', 'Turkish Airlines'], ['AAL', 'AA', 'American Airlines'], ['UAL', 'UA', 'United'], ['DAL', 'DL', 'Delta'],
  ['WZZ', 'W6', 'Wizz Air'], ['NAX', 'DY', 'Norwegian'], ['SAS', 'SK', 'SAS'], ['EWG', 'EW', 'Eurowings'],
  ['TVF', 'TO', 'Transavia France'], ['TRA', 'HV', 'Transavia'], ['IBB', 'NT', 'Binter'], ['AEE', 'A3', 'Aegean'],
  ['LOT', 'LO', 'LOT'], ['AUA', 'OS', 'Austrian'], ['FIN', 'AY', 'Finnair'], ['EIN', 'EI', 'Aer Lingus'],
  ['ELY', 'LY', 'El Al'], ['RAM', 'AT', 'Royal Air Maroc'], ['AVA', 'AV', 'Avianca'], ['LAN', 'LA', 'LATAM'],
  ['ARG', 'AR', 'Aerolíneas Argentinas'], ['AMX', 'AM', 'Aeroméxico'], ['SVA', 'SV', 'Saudia'], ['ETD', 'EY', 'Etihad'],
  ['ACA', 'AC', 'Air Canada'], ['CFG', 'DE', 'Condor'], ['TUI', 'BY', 'TUI'], ['JAF', 'TB', 'TUI fly Belgium'],
  ['PGT', 'PC', 'Pegasus'], ['CTN', 'OU', 'Croatia Airlines'], ['ICE', 'FI', 'Icelandair'], ['SXS', 'XQ', 'SunExpress'],
];
const BY_ICAO = Object.fromEntries(AIRLINE_LIST.map(([icao, iata, name]) => [icao, { icao, iata, name }]));
const BY_IATA = Object.fromEntries(AIRLINE_LIST.map(([icao, iata, name]) => [iata, { icao, iata, name }]));
export const airlineName = (cs) => BY_ICAO[(cs || '').slice(0, 3)]?.name || '';
/** Datos de una aerolínea a partir de su código OACI (3 letras) o IATA (2). */
export const airlineInfo = (code) => (code ? BY_ICAO[code] || BY_IATA[code] || null : null);

// --- Fuentes de posiciones -------------------------------------------------

function fromAdsbLol(ac) {
  const onGround = ac.alt_baro === 'ground';
  return {
    hex: ac.hex,
    callsign: (ac.flight || '').trim(),
    reg: ac.r || '',
    type: ac.t || '',
    desc: ac.desc || '',
    lat: ac.lat ?? ac.lastPosition?.lat,
    lon: ac.lon ?? ac.lastPosition?.lon,
    altFt: onGround ? 0 : (typeof ac.alt_baro === 'number' ? ac.alt_baro : ac.alt_geom ?? null),
    speedKmh: ac.gs != null ? ac.gs * KNOT_KMH : null,
    track: ac.track ?? ac.true_heading ?? null,
    onGround,
    seenAgoS: ac.seen_pos ?? ac.seen ?? 0,
  };
}

function fromOpenSky(s) {
  return {
    hex: s[0], callsign: (s[1] || '').trim(), reg: '', type: '', desc: '', country: s[2],
    lon: s[5], lat: s[6], altFt: s[7] != null ? s[7] * 3.28084 : null, onGround: !!s[8],
    speedKmh: s[9] != null ? s[9] * 3.6 : null, track: s[10], seenAgoS: s[4] ? Date.now() / 1000 - s[4] : 0,
  };
}

async function json(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) { const e = new Error(`HTTP ${r.status} en ${new URL(url, location.href).host}`); e.status = r.status; throw e; }
  return r.json();
}

/** Aviones dentro de varios círculos a lo largo de la ruta (vía proxy de adsb.lol). */
async function aircraftViaAdsb(proxy, centers, signal) {
  const seen = new Map();
  const radiusNm = 250;
  const results = await Promise.allSettled(
    centers.map((c) => json(`${proxy}/v2/point/${c.lat.toFixed(3)}/${c.lon.toFixed(3)}/${radiusNm}`, { signal })),
  );
  let ok = 0;
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    ok++;
    for (const ac of r.value.ac || []) if (ac.lat != null || ac.lastPosition) seen.set(ac.hex, fromAdsbLol(ac));
  }
  if (!ok) throw results[0].reason;
  return [...seen.values()];
}

/** Aviones en un rectángulo (OpenSky, anónimo). */
async function aircraftViaOpenSky(box, signal) {
  const u = `${CONFIG.openskyBase}/states/all?lamin=${box.lamin}&lomin=${box.lomin}&lamax=${box.lamax}&lomax=${box.lomax}`;
  const j = await json(u, { signal });
  return (j.states || []).map(fromOpenSky).filter((a) => a.lat != null);
}

// --- Rutas (origen/destino de cada indicativo) -----------------------------

const routeCache = new Map();

function parseRoute(r) {
  const airports = (r._airports || []).map((a) => ({ iata: a.iata, icao: a.icao, name: a.name, city: a.location, lat: a.lat, lon: a.lon }));
  const codes = airports.length ? airports.map((a) => a.icao || a.iata) : (r.airport_codes || '').split('-').filter(Boolean);
  return { airports, codes, iataCodes: r._airport_codes_iata || airports.map((a) => a.iata).join('-'), plausible: r.plausible !== false && r.plausible !== 0, airline: r.airline_code, number: r.number };
}

async function lookupRoutes(proxy, planes, signal) {
  const todo = planes.filter((p) => p.callsign && !routeCache.has(p.callsign));
  if (proxy) {
    for (let i = 0; i < todo.length; i += 100) {
      const body = { planes: todo.slice(i, i + 100).map((p) => ({ callsign: p.callsign, lat: p.lat, lng: p.lon })) };
      try {
        const res = await json(`${proxy}/api/0/routeset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
        for (const r of Array.isArray(res) ? res : []) if (r && r.callsign) routeCache.set(r.callsign, parseRoute(r));
      } catch (e) { if (e.name === 'AbortError') throw e; }
    }
  } else {
    // Sin proxy: consulta individual (el endpoint GET de rutas de adsb.lol permite CORS).
    const queue = todo.slice(0, 30);
    const worker = async () => {
      while (queue.length) {
        const p = queue.shift();
        try {
          const r = await json(`https://api.adsb.lol/api/0/route/${encodeURIComponent(p.callsign)}/${p.lat}/${p.lon}`, { signal });
          routeCache.set(p.callsign, parseRoute(Array.isArray(r) ? r[0] || {} : r));
        } catch (e) { if (e.name === 'AbortError') throw e; routeCache.set(p.callsign, null); }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }
  for (const p of todo) if (!routeCache.has(p.callsign)) routeCache.set(p.callsign, null);
}

const centroid = (list) => ({ lat: list.reduce((s, a) => s + a.lat, 0) / list.length, lon: list.reduce((s, a) => s + a.lon, 0) / list.length });

/**
 * Vuelos que ahora mismo van (o están a punto de ir) de alguno de los aeropuertos de
 * origen a alguno de destino.
 */
export async function findLiveFlights(origins, dests, proxy, signal) {
  if (!origins.length || !dests.length) return { flights: [], source: null };
  const O = centroid(origins);
  const D = centroid(dests);
  const dist = distanceKm(O, D);

  // 1) Aviones en la zona.
  let aircraft, source;
  if (proxy) {
    const n = Math.min(12, Math.max(2, Math.ceil(dist / 650) + 1));
    const centers = Array.from({ length: n }, (_, i) => greatCirclePoint(O, D, n === 1 ? 0 : i / (n - 1)));
    aircraft = await aircraftViaAdsb(proxy, centers, signal);
    source = 'adsb.lol';
  } else {
    const all = [...origins, ...dests];
    const pad = 1.5;
    const box = {
      lamin: (Math.min(...all.map((a) => a.lat)) - pad).toFixed(2), lamax: (Math.max(...all.map((a) => a.lat)) + pad).toFixed(2),
      lomin: (Math.min(...all.map((a) => a.lon)) - pad).toFixed(2), lomax: (Math.max(...all.map((a) => a.lon)) + pad).toFixed(2),
    };
    aircraft = await aircraftViaOpenSky(box, signal);
    source = 'OpenSky Network';
  }

  // 2) Filtro geométrico: en tierra en un aeropuerto de origen, o en el "pasillo"
  //    entre origen y destino y con rumbo razonable hacia el destino.
  const candidates = aircraft.filter((p) => {
    if (!p.callsign || p.lat == null) return false;
    const nearOrigin = origins.some((a) => distanceKm(a, p) < 6);
    if (p.onGround) return nearOrigin;
    const detour = distanceKm(O, p) + distanceKm(p, D);
    if (detour > dist * 1.3 + 80) return false;
    if (p.track == null || distanceKm(p, D) < 40) return true;
    return angleDiff(p.track, bearingDeg(p, D)) < 70;
  });

  // 3) Ruta de cada candidato y comprobación de origen → destino.
  await lookupRoutes(proxy, candidates, signal);
  const oCodes = new Set(origins.flatMap((a) => [a.icao, a.iata]));
  const dCodes = new Set(dests.flatMap((a) => [a.icao, a.iata]));
  const flights = [];
  for (const p of candidates) {
    const route = routeCache.get(p.callsign);
    if (!route) continue;
    const codes = route.airports.length ? route.airports.map((a) => [a.icao, a.iata]) : route.codes.map((c) => [c]);
    const oi = codes.findIndex((c) => c.some((x) => oCodes.has(x)));
    const di = codes.findIndex((c, i) => i > oi && c.some((x) => dCodes.has(x)));
    if (oi < 0 || di < 0) continue;
    const pick = (cands, set) => cands.find((a) => set.has(a.icao) || set.has(a.iata));
    // El nombre de ciudad que da la ruta ("A Coruña") es más claro que el municipio del aeropuerto ("Culleredo").
    const withCity = (ap, i) => ({ ...ap, city: route.airports[i]?.city || ap.city });
    const oAp = withCity(pick(origins, new Set(codes[oi])) || origins[0], oi);
    const dAp = withCity(pick(dests, new Set(codes[di])) || dests[0], di);
    flights.push({ ...p, airline: airlineName(p.callsign), origin: oAp, dest: dAp, routeText: route.iataCodes, plausible: route.plausible, routeAirline: route.airline, routeNumber: route.number });
  }
  return { flights, source };
}

/** Nueva posición de un avión concreto. */
export async function refreshAircraft(hex, proxy, signal) {
  if (proxy) {
    const j = await json(`${proxy}/v2/hex/${hex}`, { signal });
    const ac = (j.ac || [])[0];
    return ac ? fromAdsbLol(ac) : null;
  }
  const j = await json(`${CONFIG.openskyBase}/states/all?icao24=${hex.toLowerCase()}`, { signal });
  const s = (j.states || [])[0];
  return s ? fromOpenSky(s) : null;
}

// --- Nombre del lugar (Nominatim / OpenStreetMap) ---------------------------

const placeCache = new Map();
let lastNominatim = 0;

export async function placeName(lat, lon) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (placeCache.has(key)) return placeCache.get(key);
  const wait = 1100 - (Date.now() - lastNominatim);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
  let name = null;
  try {
    const lang = navigator.language || 'es';
    const j = await json(`${CONFIG.nominatimBase}/reverse?format=jsonv2&zoom=10&lat=${lat}&lon=${lon}&accept-language=${lang}`);
    const a = j.address || {};
    const local = a.city || a.town || a.village || a.municipality || a.county || a.state_district;
    const region = a.state || a.province || a.region;
    name = [local, region && region !== local ? region : null, a.country].filter(Boolean).join(', ') || null;
  } catch { /* sin nombre */ }
  placeCache.set(key, name);
  return name;
}
