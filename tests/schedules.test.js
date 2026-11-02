import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sideTimes, fromSchedule, routeOccurrences, matchesLive } from '../js/schedules.js';

const LCG = { iata: 'LCG', icao: 'LECO', lat: 43.3, lon: -8.37, city: 'A Coruña' };
const MAD = { iata: 'MAD', icao: 'LEMD', lat: 40.47, lon: -3.56, city: 'Madrid' };

test('horas: real = efectiva > estimada > programada (UTC)', () => {
  const t = sideTimes({ dep_time_utc: '2026-11-02 17:30', dep_estimated_utc: '2026-11-02 17:45' }, 'dep');
  assert.equal(t.sched, Date.UTC(2026, 10, 2, 17, 30));
  assert.equal(t.real, Date.UTC(2026, 10, 2, 17, 45));
  assert.equal(t.actual, false);
  const t2 = sideTimes({ dep_time_ts: 1000, dep_actual_ts: 1600 }, 'dep');
  assert.equal(t2.real, 1600000);
  assert.equal(t2.actual, true);
});

test('fromSchedule completa la llegada con la duración y la aerolínea', () => {
  const f = fromSchedule({ flight_iata: 'IB549', flight_number: '549', airline_iata: 'IB', dep_time_utc: '2026-11-02 17:30', duration: 70, status: 'scheduled', dep_gate: 'B4' }, LCG, MAD);
  assert.equal(f.arr.sched, Date.UTC(2026, 10, 2, 18, 40));
  assert.equal(f.airline, 'Iberia');
  assert.equal(f.flightIcao, 'IBE549');
  assert.equal(f.depGate, 'B4');
  assert.equal(f.statusText, 'Programado');
});

test('rutas habituales: solo los días que opera y dentro de la ventana', () => {
  // Lunes 2 de noviembre de 2026
  const from = Date.UTC(2026, 10, 2, 12, 0);
  const to = from + 48 * 3600000;
  const r = { flight_iata: 'VY1234', airline_iata: 'VY', dep_time_utc: '06:15', duration: 65, days: ['tue'] };
  const occ = routeOccurrences(r, LCG, MAD, from, to);
  assert.equal(occ.length, 1);
  assert.equal(occ[0].dep.sched, Date.UTC(2026, 10, 3, 6, 15));
  assert.equal(occ[0].usual, true);
  assert.equal(occ[0].airline, 'Vueling');
});

test('empareja el vuelo programado con el avión en el aire', () => {
  const s = { number: '549', airlineIcao: 'IBE', airlineIata: 'IB' };
  assert.ok(matchesLive(s, { callsign: 'IBE0549' }));
  assert.ok(matchesLive(s, { callsign: 'XXX99', routeAirline: 'IBE', routeNumber: '0549' }));
  assert.ok(!matchesLive(s, { callsign: 'IBE5491' }));
  assert.ok(!matchesLive(s, { callsign: 'VLG549' }));
});
