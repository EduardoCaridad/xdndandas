import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTransitProgress, computeFlightProgress, normalizeStop, formatDuration } from '../js/progress.js';
import { decodePolyline, distanceKm } from '../js/geo.js';

const T = (h, m) => Date.UTC(2026, 10, 2, h, m);
// Coruña → Santiago → Ourense (coordenadas aproximadas)
const stops = [
  { name: 'A Coruña', lat: 43.3539, lon: -8.4092, arr: T(8, 0), dep: T(8, 0), schedArr: T(8, 0), schedDep: T(8, 0) },
  { name: 'Santiago', lat: 42.8706, lon: -8.5445, arr: T(8, 30), dep: T(8, 35), schedArr: T(8, 28), schedDep: T(8, 33) },
  { name: 'Ourense', lat: 42.3504, lon: -7.8749, arr: T(9, 15), dep: T(9, 15), schedArr: T(9, 10), schedDep: T(9, 10) },
];

test('antes de salir: 0 %', () => {
  const p = computeTransitProgress(stops, null, T(7, 50));
  assert.equal(p.status, 'not_started');
  assert.equal(p.pct, 0);
  assert.equal(p.delayMin, 5);
});

test('a mitad del primer tramo', () => {
  const p = computeTransitProgress(stops, null, T(8, 15));
  assert.equal(p.status, 'moving');
  assert.match(p.label, /Entre A Coruña y Santiago/);
  const d1 = distanceKm(stops[0], stops[1]);
  assert.ok(Math.abs(p.doneKm - d1 / 2) < 0.5);
  assert.ok(p.position.lat < 43.3539 && p.position.lat > 42.8706);
});

test('detenido en parada intermedia', () => {
  const p = computeTransitProgress(stops, null, T(8, 32));
  assert.equal(p.status, 'at_stop');
  assert.equal(p.atStop, 1);
  assert.match(p.label, /Santiago/);
});

test('llegado: 100 %', () => {
  const p = computeTransitProgress(stops, null, T(9, 20));
  assert.equal(p.status, 'arrived');
  assert.equal(p.pct, 100);
  assert.equal(p.remainingMs, 0);
});

test('usa la geometría de la ruta si existe', () => {
  // Ruta con un rodeo hacia el este entre las dos primeras paradas
  const shape = [stops[0], { lat: 43.1, lon: -8.0 }, stops[1], stops[2]];
  const p = computeTransitProgress(stops, shape, T(8, 30));
  assert.ok(p.totalKm > distanceKm(stops[0], stops[1]) + distanceKm(stops[1], stops[2]));
});

test('normalizeStop usa tiempo real y cae a programado', () => {
  const s = normalizeStop({ name: 'X', lat: 1, lon: 2, scheduledDeparture: '2026-11-02T08:00:00Z', departure: '2026-11-02T08:04:00Z' });
  assert.equal(s.dep - s.schedDep, 4 * 60000);
  assert.equal(s.arr, s.dep);
});

test('progreso de vuelo por distancia', () => {
  const lcg = { lat: 43.3021, lon: -8.3773 };
  const mad = { lat: 40.4719, lon: -3.5626 };
  const mid = { lat: 41.9, lon: -6.0, speedKmh: 800, onGround: false };
  const p = computeFlightProgress(lcg, mad, mid, 0);
  assert.equal(p.status, 'moving');
  assert.ok(p.pct > 40 && p.pct < 60, `pct=${p.pct}`);
  const g = computeFlightProgress(lcg, mad, { ...lcg, onGround: true });
  assert.equal(g.status, 'not_started');
  assert.equal(computeFlightProgress(lcg, mad, { ...mad, onGround: true }).status, 'arrived');
});

test('decodifica polilíneas (ejemplo oficial de Google, precisión 5)', () => {
  const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5);
  assert.deepEqual(pts.map((p) => [p.lat, p.lon]), [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
});

test('formatDuration', () => {
  assert.equal(formatDuration(65 * 60000), '1 h 5 min');
  assert.equal(formatDuration(8 * 60000), '8 min');
  assert.equal(formatDuration(20000), 'menos de 1 min');
});
