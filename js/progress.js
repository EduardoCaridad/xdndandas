// Cálculo del progreso de un vehículo. Funciones puras (sin red), probadas en tests/.
import { distanceKm, cumulative, pointAtDistance, nearestVertex, greatCirclePoint } from './geo.js';

const t = (v) => (v ? new Date(v).getTime() : null);

/**
 * Normaliza una parada de MOTIS a {name, lat, lon, arr, dep, schedArr, schedDep, cancelled}.
 * Usa la hora en tiempo real si existe; si no, la programada.
 */
export function normalizeStop(p) {
  const arr = t(p.arrival) ?? t(p.scheduledArrival);
  const dep = t(p.departure) ?? t(p.scheduledDeparture);
  return {
    name: p.name,
    stopId: p.stopId,
    lat: p.lat,
    lon: p.lon,
    arr: arr ?? dep,
    dep: dep ?? arr,
    schedArr: t(p.scheduledArrival) ?? t(p.scheduledDeparture),
    schedDep: t(p.scheduledDeparture) ?? t(p.scheduledArrival),
    track: p.track || p.scheduledTrack || '',
    cancelled: !!p.cancelled,
  };
}

/**
 * Progreso de un tren/autobús a partir de sus paradas con horas (en tiempo real o
 * programadas) y, opcionalmente, la geometría de la ruta.
 *
 * @param {Array} stops  paradas normalizadas, en orden, desde donde sube el viajero
 *                       hasta donde baja.
 * @param {Array|null} shape  puntos {lat, lon} de la ruta (puede ser null).
 * @param {number} now   instante actual en ms.
 */
export function computeTransitProgress(stops, shape, now) {
  const n = stops.length;
  if (n < 2) throw new Error('Se necesitan al menos dos paradas');

  // Distancias de cada parada a lo largo de la ruta.
  let along, path, pathCum;
  if (shape && shape.length > 1) {
    path = shape;
    pathCum = cumulative(path);
    along = [];
    let from = 0;
    for (const s of stops) {
      from = nearestVertex(path, s, from);
      along.push(pathCum[from]);
    }
    // La parte de la ruta que interesa empieza en la primera parada.
  } else {
    path = stops;
    pathCum = cumulative(stops);
    along = pathCum.slice();
  }
  const startKm = along[0];
  const totalKm = Math.max(0.001, along[n - 1] - startKm);
  const first = stops[0];
  const last = stops[n - 1];

  const base = {
    totalKm,
    departure: first.dep,
    arrival: last.arr,
    delayMin: last.schedArr ? Math.round((last.arr - last.schedArr) / 60000) : 0,
    remainingMs: Math.max(0, last.arr - now),
  };

  if (now < first.dep) {
    return {
      ...base, status: 'not_started', pct: 0, doneKm: 0,
      position: { lat: first.lat, lon: first.lon },
      atStop: 0, prevStop: null, nextStop: 0,
      label: `Aún no ha salido de ${first.name}`,
    };
  }
  if (now >= last.arr) {
    return {
      ...base, status: 'arrived', pct: 100, doneKm: totalKm,
      position: { lat: last.lat, lon: last.lon },
      atStop: n - 1, prevStop: n - 1, nextStop: null,
      label: `Ha llegado a ${last.name}`,
    };
  }

  for (let i = 0; i < n; i++) {
    const s = stops[i];
    // Detenido en una parada intermedia.
    if (i > 0 && i < n - 1 && now >= s.arr && now < s.dep) {
      const done = along[i] - startKm;
      return {
        ...base, status: 'at_stop', pct: (done / totalKm) * 100, doneKm: done,
        position: { lat: s.lat, lon: s.lon },
        atStop: i, prevStop: i, nextStop: i + 1,
        label: `Detenido en ${s.name}`,
      };
    }
    // Circulando entre la parada i y la i+1.
    if (i < n - 1 && now >= s.dep && now < stops[i + 1].arr) {
      const nx = stops[i + 1];
      const span = Math.max(1, nx.arr - s.dep);
      const f = Math.min(1, Math.max(0, (now - s.dep) / span));
      const km = along[i] + (along[i + 1] - along[i]) * f;
      const done = km - startKm;
      return {
        ...base, status: 'moving', pct: (done / totalKm) * 100, doneKm: done,
        position: pointAtDistance(path, pathCum, km),
        atStop: null, prevStop: i, nextStop: i + 1,
        label: `Entre ${s.name} y ${nx.name}`,
      };
    }
  }
  // Horas incoherentes (p. ej. tiempo real parcial): estimación lineal por tiempo.
  const f = (now - first.dep) / Math.max(1, last.arr - first.dep);
  const km = startKm + totalKm * f;
  return {
    ...base, status: 'moving', pct: f * 100, doneKm: totalKm * f,
    position: pointAtDistance(path, pathCum, km),
    atStop: null, prevStop: null, nextStop: null,
    label: `En ruta hacia ${last.name}`,
  };
}

/**
 * Progreso de un vuelo a partir de su posición real (ADS-B).
 * @param {{lat,lon}} origin aeropuerto de salida
 * @param {{lat,lon}} dest   aeropuerto de llegada
 * @param {{lat,lon,speedKmh,onGround}} plane posición actual
 */
export function computeFlightProgress(origin, dest, plane, now = Date.now()) {
  const totalKm = Math.max(0.001, distanceKm(origin, dest));
  const fromOrigin = distanceKm(origin, plane);
  const toDest = distanceKm(plane, dest);
  // Proyección sobre la ruta: proporción del camino recorrido.
  const pct = Math.min(100, Math.max(0, (fromOrigin / (fromOrigin + toDest)) * 100));
  let status = 'moving';
  if (plane.onGround && fromOrigin < 8) status = 'not_started';
  else if (plane.onGround && toDest < 8) status = 'arrived';
  const speed = plane.speedKmh && plane.speedKmh > 150 ? plane.speedKmh : 750; // valor típico si no hay dato
  // Añadimos ~12 min de aproximación y aterrizaje si aún está lejos.
  const remainingMs = status === 'arrived' ? 0 : (toDest / speed) * 3600000 + (toDest > 60 ? 12 * 60000 : 0);
  return {
    status,
    pct: status === 'arrived' ? 100 : status === 'not_started' ? 0 : pct,
    totalKm,
    doneKm: status === 'arrived' ? totalKm : totalKm * (pct / 100),
    remainingKm: status === 'arrived' ? 0 : toDest,
    remainingMs,
    arrival: now + remainingMs,
    position: { lat: plane.lat, lon: plane.lon },
  };
}

/** Puntos del arco de círculo máximo entre dos aeropuertos (para dibujar en el mapa). */
export function greatCircleLine(a, b, steps = 64) {
  const pts = [];
  for (let i = 0; i <= steps; i++) pts.push(greatCirclePoint(a, b, i / steps));
  return pts;
}

/** "1 h 25 min", "8 min", "menos de 1 min". */
export function formatDuration(ms) {
  if (ms == null || !isFinite(ms)) return '—';
  const m = Math.round(ms / 60000);
  if (m < 1) return 'menos de 1 min';
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h} h${r ? ` ${r} min` : ''}` : `${r} min`;
}
