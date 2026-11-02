// Utilidades geográficas sin dependencias.
const R = 6371.0088; // radio medio de la Tierra en km
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Distancia en km entre dos puntos {lat, lon}. */
export function distanceKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rumbo inicial en grados (0 = norte) de a hacia b. */
export function bearingDeg(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Diferencia angular absoluta (0..180). */
export function angleDiff(a, b) {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/** Punto intermedio en el círculo máximo entre a y b (f entre 0 y 1). */
export function greatCirclePoint(a, b, f) {
  const d = distanceKm(a, b) / R;
  if (d === 0) return { lat: a.lat, lon: a.lon };
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(rad(a.lat)) * Math.cos(rad(a.lon)) + B * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon));
  const y = A * Math.cos(rad(a.lat)) * Math.sin(rad(a.lon)) + B * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon));
  const z = A * Math.sin(rad(a.lat)) + B * Math.sin(rad(b.lat));
  return { lat: deg(Math.atan2(z, Math.sqrt(x * x + y * y))), lon: deg(Math.atan2(y, x)) };
}

/** Decodifica una polilínea de Google con la precisión indicada (5, 6 o 7). */
export function decodePolyline(str, precision = 6) {
  const factor = 10 ** precision;
  const pts = [];
  let index = 0, lat = 0, lon = 0;
  while (index < str.length) {
    let result = 0, shift = 0, b;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0; shift = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lon += result & 1 ? ~(result >> 1) : result >> 1;
    pts.push({ lat: lat / factor, lon: lon / factor });
  }
  return pts;
}

/** Distancias acumuladas (km) a lo largo de una lista de puntos. */
export function cumulative(points) {
  const out = [0];
  for (let i = 1; i < points.length; i++) out.push(out[i - 1] + distanceKm(points[i - 1], points[i]));
  return out;
}

/** Punto situado a `km` desde el inicio de la polilínea. */
export function pointAtDistance(points, cum, km) {
  if (km <= 0) return { ...points[0] };
  const total = cum[cum.length - 1];
  if (km >= total) return { ...points[points.length - 1] };
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= km) lo = mid; else hi = mid; }
  const seg = cum[hi] - cum[lo];
  const f = seg > 0 ? (km - cum[lo]) / seg : 0;
  return {
    lat: points[lo].lat + (points[hi].lat - points[lo].lat) * f,
    lon: points[lo].lon + (points[hi].lon - points[lo].lon) * f,
  };
}

/** Índice del vértice de la polilínea más cercano a p, buscando a partir de `from`. */
export function nearestVertex(points, p, from = 0) {
  let best = from, bestD = Infinity;
  for (let i = from; i < points.length; i++) {
    const d = distanceKm(points[i], p);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
