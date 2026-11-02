import { CONFIG, resolveAdsbProxy, isNativeApp } from './config.js';
import { geocode, planGroup, cityStations, getTrip, isTransitLeg, modeCategory, legTitle } from './transitous.js';
import { airportsFor, findLiveFlights, refreshAircraft, placeName, loadAirports } from './flights.js';
import { getAirlabsKey, setAirlabsKey, scheduledFlights, matchesLive } from './schedules.js';
import { normalizeStop, computeTransitProgress, computeFlightProgress, greatCircleLine, formatDuration } from './progress.js';
import { decodePolyline, distanceKm, greatCirclePoint, bearingDeg } from './geo.js';

// ---------------------------------------------------------------- utilidades
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hhmm = (ms) => (ms == null ? '—' : new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }));
const fmtKm = (km) => `${km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString('es-ES')} km`;
const ICON = { train: '🚆', bus: '🚌', plane: '✈️', ferry: '⛴️', other: '🚏' };
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};

let adsbProxy = '';
resolveAdsbProxy().then((p) => { adsbProxy = p; });

// ------------------------------------------------------------ autocompletado
const selected = { from: null, to: null };

// --- Estaciones de la ciudad elegida (vacío = todas)
const chosenStations = { from: new Set(), to: new Set() };

async function loadStations(key, keep = false) {
  const box = $(`${key}-stations`);
  const p = selected[key];
  if (!keep) chosenStations[key].clear();
  if (!p || p.type === 'STOP') { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = '<span class="muted small"><span class="spinner"></span>Buscando estaciones…</span>';
  try {
    const st = await cityStations(p);
    if (selected[key] !== p) return;
    renderStations(key, p, st);
  } catch {
    if (selected[key] === p) box.innerHTML = '<span class="muted small">No se pudieron cargar las estaciones; se buscará en todas.</span>';
  }
}

function renderStations(key, place, st) {
  const box = $(`${key}-stations`);
  const set = chosenStations[key];
  const items = [...st.train, ...st.bus];
  if (!items.length) {
    box.innerHTML = '<span class="muted small">No encuentro estaciones por su nombre; se buscará desde el centro de la ciudad.</span>';
    return;
  }
  box.innerHTML = `
    <div class="st-label">Estaciones de ${esc(place.name.split(',')[0])} <small>· toca una o varias para elegir</small></div>
    <button type="button" class="st-chip ${set.size ? '' : 'on'}" data-st="">Todas</button>
    ${items.map((x) => `<button type="button" class="st-chip ${set.has(x.id) ? 'on' : ''}" data-st="${esc(x.id)}" title="${x.distKm.toFixed(1)} km del centro">${x.group === 'train' ? '🚆' : '🚌'} ${esc(x.name)}</button>`).join('')}`;
  box.onclick = (e) => {
    const b = e.target.closest('[data-st]');
    if (!b) return;
    const id = b.dataset.st;
    if (!id) set.clear(); else if (set.has(id)) set.delete(id); else set.add(id);
    renderStations(key, place, st);
  };
}

function setupAutocomplete(key) {
  const input = $(key);
  const list = $(`${key}-suggestions`);
  let timer, ctrl, items = [], active = -1;

  const close = () => { list.innerHTML = ''; items = []; active = -1; input.setAttribute('aria-expanded', 'false'); };
  const choose = (m) => { selected[key] = m; input.value = m.name; close(); loadStations(key); };
  const paint = () => {
    list.innerHTML = items.map((m, i) => `
      <li role="option" data-i="${i}" aria-selected="${i === active}">
        ${m.type === 'STOP' ? '🚉' : '📍'} ${esc(m.name)}
        <span class="s-sub">${m.type === 'STOP' ? 'Estación / parada' : 'Ciudad o lugar (todas sus estaciones)'}${m.area ? ' · ' + esc(m.area) : ''}</span>
      </li>`).join('');
    input.setAttribute('aria-expanded', items.length ? 'true' : 'false');
  };

  input.addEventListener('input', () => {
    selected[key] = null;
    loadStations(key);
    clearTimeout(timer);
    const text = input.value.trim();
    if (text.length < 2) return close();
    timer = setTimeout(async () => {
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        items = await geocode(text, ctrl.signal);
        active = -1;
        paint();
      } catch (e) { if (e.name !== 'AbortError') close(); }
    }, 250);
  });
  input.addEventListener('keydown', (e) => {
    if (!items.length) return;
    if (e.key === 'ArrowDown') { active = (active + 1) % items.length; paint(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = (active - 1 + items.length) % items.length; paint(); e.preventDefault(); }
    else if (e.key === 'Enter' && active >= 0) { choose(items[active]); e.preventDefault(); }
    else if (e.key === 'Escape') close();
  });
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li');
    if (li) { e.preventDefault(); choose(items[+li.dataset.i]); }
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
}

/** Si el usuario no eligió una sugerencia, se toma la mejor coincidencia. */
async function resolvePlace(key) {
  if (selected[key]) return selected[key];
  const text = $(key).value.trim();
  if (!text) throw new Error(`Escribe ${key === 'from' ? 'el origen' : 'el destino'}.`);
  try {
    const res = await geocode(text);
    const best = res.find((m) => m.type === 'PLACE') || res[0];
    if (best) { selected[key] = best; loadStations(key); return best; }
  } catch { /* probamos con los aeropuertos */ }
  const ap = (await loadAirports()).find((a) => [a.city, a.name, a.iata].some((s) => s.toLowerCase().includes(text.toLowerCase())));
  if (ap) return (selected[key] = { type: 'PLACE', name: ap.city || ap.name, lat: ap.lat, lon: ap.lon });
  throw new Error(`No encuentro "${text}". Prueba con otro nombre.`);
}

// ------------------------------------------------------------------ búsqueda
let searchCtrl;
let lastGround = [];
let lastFlights = [];

function selectedModes() {
  return [...document.querySelectorAll('input[name=mode]:checked')].map((i) => i.value);
}

async function onSearch(e) {
  e.preventDefault();
  for (const l of document.querySelectorAll('.suggestions')) l.innerHTML = '';
  const btn = $('search-btn');
  const out = $('results');
  searchCtrl?.abort();
  searchCtrl = new AbortController();
  const signal = searchCtrl.signal;

  let from, to;
  try {
    [from, to] = await Promise.all([resolvePlace('from'), resolvePlace('to')]);
  } catch (err) {
    out.innerHTML = `<div class="notice error">${esc(err.message)}</div>`;
    return;
  }
  const modes = selectedModes();
  const all = modes.length === 0;
  // Trenes y autobuses van siempre por separado: nunca se mezclan en un mismo trayecto.
  const groundGroups = ['train', 'bus'].filter((g) => all || modes.includes(g));
  const wantFlights = all || modes.includes('plane');
  const dayStart = new Date(`${$('date').value}T00:00:00`);
  const directOnly = $('direct').checked;
  // Hoy: lo que está en camino + lo que sale en las próximas 24 h. Otro día: el día entero.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const isToday = dayStart.getTime() === today.getTime();
  const now = Date.now();
  const win = isToday
    ? { isToday, start: now - 8 * 3600000, end: now + 24 * 3600000 }
    : { isToday, start: dayStart.getTime(), end: dayStart.getTime() + 24 * 3600000 };
  const when = isToday ? ' · en camino y próximas 24 h' : ` · ${dayStart.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}`;
  const fromChoice = [...chosenStations.from], toChoice = [...chosenStations.to];
  store.set('last-search', { from, to, date: $('date').value, modes, directOnly, fromChoice, toChoice });

  btn.disabled = true;
  out.innerHTML = `
    ${groundGroups.map((g) => `<h3>${GROUP_TITLE[g]}<small class="muted">${esc(when)}</small></h3><div id="ground-${g}"><div class="notice"><span class="spinner"></span>Buscando ${g === 'train' ? 'trenes' : 'autobuses'}…</div></div>`).join('')}
    ${wantFlights ? `<h3>✈️ Vuelos<small class="muted">${esc(when)}</small></h3><div id="flights"><div class="notice"><span class="spinner"></span>Buscando vuelos…</div></div>` : ''}`;

  const tasks = [];
  lastGround = [];
  for (const g of groundGroups) tasks.push(searchGround({ from, to, win, directOnly, fromChoice, toChoice }, g, signal));
  if (wantFlights) tasks.push(searchFlights(from, to, win, signal));
  await Promise.allSettled(tasks);
  if (!signal.aborted) btn.disabled = false;
}

// --- Trenes y autobuses (y vuelos con horario, si Transitous los tiene)

function itinSummary(it) {
  const legs = it.legs.filter(isTransitLeg);
  if (!legs.length) return null;
  const first = legs[0], last = legs[legs.length - 1];
  const dep = new Date(first.startTime).getTime();
  const arr = new Date(last.endTime).getTime();
  const schedDep = new Date(first.scheduledStartTime).getTime();
  const schedArr = new Date(last.scheduledEndTime).getTime();
  return {
    it, legs, dep, arr, schedDep, schedArr,
    category: modeCategory(first.mode),
    key: legs.map((l) => `${l.tripId}|${l.from.stopId || l.from.name}`).join('>'),
    realTime: legs.some((l) => l.realTime),
    cancelled: legs.some((l) => l.cancelled),
  };
}

function statusOf(dep, arr, now = Date.now()) {
  if (now < dep) {
    const mins = (dep - now) / 60000;
    return { cls: 'planned', text: mins < 180 ? `Sale en ${formatDuration(dep - now)}` : 'Programado' };
  }
  if (now < arr) return { cls: 'moving', text: 'En camino' };
  return { cls: 'done', text: 'Ha llegado' };
}

function delayHtml(real, sched) {
  const d = Math.round((real - sched) / 60000);
  if (!isFinite(d)) return hhmm(real);
  if (d >= 2) return `<span class="late">${hhmm(real)}</span> <del>${hhmm(sched)}</del>`;
  return hhmm(real);
}

function renderGroundItem(s, idx) {
  const st = s.cancelled ? { cls: 'done', text: 'Cancelado' } : statusOf(s.dep, s.arr);
  const title = s.legs.map(legTitle).join(' + ');
  const operators = [...new Set(s.legs.map((l) => l.agencyName).filter(Boolean))].join(', ');
  const transfers = s.legs.length - 1;
  const via = transfers ? `${transfers} transbordo${transfers > 1 ? 's' : ''} en ${s.legs.slice(1).map((l) => l.from.name).join(', ')}` : 'Directo';
  return `
    <button type="button" class="item ${st.cls === 'done' ? 'past' : ''}" data-ground="${idx}">
      <div class="icon">${ICON[s.category] || ICON.other}</div>
      <div>
        <div class="title">${esc(title)}</div>
        <div class="times">${delayHtml(s.dep, s.schedDep)} ${esc(s.legs[0].from.name)} → ${delayHtml(s.arr, s.schedArr)} ${esc(s.legs[s.legs.length - 1].to.name)}</div>
        <div class="meta">${esc(operators)}${operators ? ' · ' : ''}${formatDuration(s.arr - s.dep)} · ${esc(via)}${s.realTime ? ' · 📡 tiempo real' : ''}</div>
      </div>
      <span class="status ${st.cls}">${st.text}</span>
    </button>`;
}

const GROUP_TITLE = { train: '🚆 Trenes', bus: '🚌 Autobuses' };

async function searchGround(o, group, signal) {
  const box = $(`ground-${group}`);
  const label = group === 'train' ? 'trenes' : 'autobuses';
  try {
    const { start, end, isToday } = o.win;
    const now = Date.now();
    const res = await planGroup({ ...o, timeStart: new Date(start), windowSec: Math.round((end - start) / 1000) }, group, signal);
    const seen = new Set();
    const list = [];
    for (const it of res.itineraries) {
      const s = itinSummary(it);
      if (!s || seen.has(s.key) || s.schedDep < start || s.dep >= end) continue;
      if (isToday && s.arr <= now) continue; // hoy: fuera los que ya llegaron
      seen.add(s.key);
      s.category = group;
      list.push(s);
    }
    list.sort((a, b) => a.schedDep - b.schedDep);
    if (signal.aborted) return;
    const stations = res.stations.from.length && res.stations.to.length
      ? `<div class="notice small">Estaciones: <b>${esc(res.stations.from.join(', '))}</b> → <b>${esc(res.stations.to.join(', '))}</b></div>` : '';
    if (!list.length) {
      box.innerHTML = `${stations}<div class="notice">No hay ${o.directOnly ? `${label} directos` : label} ${isToday ? 'en camino ni en las próximas 24 h' : 'ese día'} con los datos abiertos disponibles.
        ${o.directOnly ? 'Prueba a desmarcar «Solo directos».' : ''} Puede que el operador no publique sus horarios en abierto, o prueba a elegir una estación concreta en vez de la ciudad.</div>`;
      return;
    }
    box.innerHTML = stations + list.map((s) => { lastGround.push(s); return renderGroundItem(s, lastGround.length - 1); }).join('');
  } catch (e) {
    if (e.name === 'AbortError') return;
    box.innerHTML = `<div class="notice error">No se pudieron obtener los ${label} (${esc(e.message)}). Inténtalo de nuevo en un momento.</div>`;
  }
}

// --- Vuelos: programados (AirLabs) + en el aire ahora mismo (ADS-B)

const isLanded = (s, now = Date.now()) => s.status === 'landed' || (s.status !== 'scheduled' && s.status !== 'active' && s.arr.real != null && now > s.arr.real + 15 * 60000);
const recDep = (r) => r.sched?.dep.real ?? Date.now() - 1;

function flightStatus(rec, now = Date.now()) {
  const s = rec.sched;
  if (rec.live) {
    const p = computeFlightProgress(rec.origin, rec.dest, rec.live);
    if (p.status === 'not_started') return { cls: 'planned', text: 'En pista, por salir' };
    if (p.status === 'arrived') return { cls: 'done', text: 'Aterrizado' };
    return { cls: 'moving', text: `En vuelo · ${Math.round(p.pct)} %` };
  }
  if (s.status === 'cancelled') return { cls: 'done', text: 'Cancelado' };
  if (isLanded(s, now)) return { cls: 'done', text: 'Aterrizado' };
  if (s.status === 'active') return { cls: 'moving', text: 'En vuelo' };
  if (now < s.dep.real) return statusOf(s.dep.real, s.arr.real ?? s.dep.real + 3600000, now);
  return { cls: 'planned', text: s.statusText === 'Horario habitual' ? 'Debería haber salido' : 'Embarcando / por salir' };
}

function renderFlightItem(rec, idx) {
  const s = rec.sched, l = rec.live;
  const st = flightStatus(rec);
  const o = rec.origin, d = rec.dest;
  const title = s ? `${s.flightIata}${s.airline ? ' · ' + s.airline : ''}` : `${l.callsign}${l.airline ? ' · ' + l.airline : ''}`;
  const times = s
    ? `${delayHtml(s.dep.real, s.dep.sched)} ${esc(o.iata)} ${esc(o.city || o.name)} → ${s.arr.real ? delayHtml(s.arr.real, s.arr.sched) : '—'} ${esc(d.iata)} ${esc(d.city || d.name)}`
    : `${esc(o.iata)} ${esc(o.city || o.name)} → ${esc(d.iata)} ${esc(d.city || d.name)}`;
  const alt = l ? (l.onGround ? 'en tierra' : l.altFt ? `${Math.round(l.altFt * 0.3048).toLocaleString('es-ES')} m` : '') : '';
  const meta = [
    s?.usual ? 'horario habitual (sin confirmar)' : '',
    s?.depTerminal ? `Terminal ${s.depTerminal}` : '',
    s?.depGate ? `Puerta ${s.depGate}` : '',
    l ? '📡 en directo' : '',
    l?.type || s?.aircraft || '',
    alt,
    l && !s && !l.plausible ? 'ruta sin confirmar' : '',
  ].filter(Boolean).map(esc).join(' · ');
  return `
    <button type="button" class="item ${st.cls === 'done' ? 'past' : ''}" data-flight="${idx}">
      <div class="icon">✈️</div>
      <div>
        <div class="title">${esc(title)}</div>
        <div class="times">${times}</div>
        <div class="meta">${meta}</div>
      </div>
      <span class="status ${st.cls}">${st.text}</span>
    </button>`;
}

async function searchFlights(from, to, win, signal) {
  const box = $('flights');
  const now = Date.now();
  try {
    const [origins, dests] = await Promise.all([airportsFor(from), airportsFor(to)]);
    if (!origins.length || !dests.length) {
      box.innerHTML = `<div class="notice">No encuentro aeropuertos con vuelos comerciales cerca de ${esc(!origins.length ? from.name : to.name)}.</div>`;
      return;
    }
    const apText = `${origins.map((a) => a.iata).join(', ')} → ${dests.map((a) => a.iata).join(', ')}`;
    box.innerHTML = `<div class="notice"><span class="spinner"></span>Buscando vuelos entre ${esc(apText)}…</div>`;
    if (!adsbProxy) adsbProxy = await resolveAdsbProxy();

    const hasKey = !!getAirlabsKey();
    const [liveRes, schedRes] = await Promise.all([
      win.isToday ? findLiveFlights(origins, dests, adsbProxy, signal).catch((e) => ({ error: e, flights: [] })) : { flights: [] },
      hasKey ? scheduledFlights(origins, dests, win.isToday ? now - 3 * 3600000 : win.start, win.end, signal).catch((e) => ({ error: e, flights: [] })) : { flights: [], noKey: true },
    ]);
    if (signal.aborted) return;

    // Unir: cada avión en el aire se asocia a su vuelo programado si lo encontramos.
    const recs = schedRes.flights.map((s) => ({ origin: s.origin, dest: s.dest, sched: s, live: null }));
    for (const l of liveRes.flights) {
      const m = recs.find((r) => !r.live && matchesLive(r.sched, l));
      if (m) m.live = l;
      else recs.push({ origin: l.origin, dest: l.dest, sched: null, live: l });
    }
    // Hoy: solo los que están en camino o van a salir (fuera los que ya aterrizaron).
    const list = recs
      .filter((r) => !win.isToday || r.live || !isLanded(r.sched, now))
      .filter((r) => !r.sched || r.live || r.sched.dep.real < win.end)
      .sort((a, b) => recDep(a) - recDep(b));
    lastFlights = list;

    const notes = [];
    notes.push(`<div class="notice small">Aeropuertos: <b>${esc(apText)}</b>${win.isToday ? ' · en el aire ahora: ' + esc(liveRes.source || 'ADS-B') : ''}${hasKey && !schedRes.error ? ' · horarios: AirLabs' : ''}</div>`);
    if (schedRes.noKey) {
      notes.push(`<div class="notice">Para ver también los vuelos <b>que van a salir</b>, añade tu clave gratuita de AirLabs en <button type="button" class="link inline" data-open-settings>⚙️ Ajustes</button> (se tarda 2 minutos).</div>`);
    } else if (schedRes.error) {
      notes.push(`<div class="notice error">No se pudieron cargar los vuelos programados: ${esc(schedRes.error.message)}.</div>`);
    } else if (schedRes.liveUntil && win.end > schedRes.liveUntil + 3600000 && !schedRes.flights.some((f) => f.usual)) {
      notes.push(`<div class="notice small">Los horarios en vivo llegan hasta las ${hhmm(schedRes.liveUntil)} aprox. Los vuelos posteriores aparecerán a medida que se acerque su hora.</div>`);
    }
    if (liveRes.error) {
      notes.push(`<div class="notice error small">No se pudo consultar qué aviones están en el aire (${esc(liveRes.error.message)}).
        ${adsbProxy ? '' : 'En la versión web hace falta el proxy gratuito (ver README); en la app de Android funciona directo.'}</div>`);
    }
    if (!win.isToday && !hasKey) {
      notes.push(`<div class="notice">Los aviones en el aire solo se ven el mismo día. Para ver horarios de otros días añade la clave de AirLabs en ⚙️ Ajustes.</div>`);
    }
    const empty = `<div class="notice">${win.isToday ? 'No hay vuelos en el aire ni programados en las próximas horas en esta ruta.' : 'No hay vuelos programados ese día en esta ruta.'}</div>`;
    box.innerHTML = notes[0] + (list.length ? list.map(renderFlightItem).join('') : empty) + notes.slice(1).join('');
  } catch (e) {
    if (e.name === 'AbortError') return;
    box.innerHTML = `<div class="notice error">No se pudieron consultar los vuelos (${esc(e.message)}).</div>`;
  }
}

// --------------------------------------------------------------- seguimiento
let map, layers, trackTimer, trackCtrl, currentUpdate;

function showView(name) {
  $('search-view').hidden = name !== 'search';
  $('track-view').hidden = name !== 'track';
  window.scrollTo({ top: 0 });
}

function ensureMap() {
  if (!window.L) return null;
  if (!map) {
    map = L.map('map', { zoomControl: true, attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    layers = L.layerGroup().addTo(map);
  }
  setTimeout(() => map.invalidateSize(), 50);
  return map;
}

function vehicleIcon(emoji, rotate = 0) {
  return L.divIcon({ className: '', html: `<div class="vehicle-marker" style="transform:rotate(${rotate}deg)">${emoji}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] });
}

function stopTracking() {
  clearInterval(trackTimer);
  trackCtrl?.abort();
}

function setProgress(pct, emoji) {
  const v = Math.max(0, Math.min(100, pct));
  $('t-fill').style.width = `${v}%`;
  $('t-dot').style.left = `${v}%`;
  $('t-dot').textContent = emoji;
  $('t-bar').setAttribute('aria-valuenow', Math.round(v));
  $('t-pct').textContent = `${Math.round(v)} % recorrido`;
}

function fact(label, value) { return `<div class="fact"><span>${esc(label)}</span><b>${value}</b></div>`; }

function touchUpdated() {
  $('t-updated').textContent = new Date().toLocaleTimeString('es-ES');
  $('t-every').textContent = CONFIG.refreshSeconds;
}

// --- Trenes y autobuses

function legStops(planLeg, tripItin) {
  const tripLeg = tripItin?.legs?.find((l) => l.tripId === planLeg.tripId) || tripItin?.legs?.[0];
  const planStops = [planLeg.from, ...(planLeg.intermediateStops || []), planLeg.to];
  if (!tripLeg) return { stops: planStops.map(normalizeStop), full: null, geometry: planLeg.legGeometry, realTime: planLeg.realTime };
  const full = [tripLeg.from, ...(tripLeg.intermediateStops || []), tripLeg.to];
  const same = (a, b) => (a.stopId && b.stopId && a.stopId === b.stopId) || a.name === b.name;
  const i0 = full.findIndex((p) => same(p, planLeg.from));
  const i1 = i0 >= 0 ? full.findIndex((p, i) => i > i0 && same(p, planLeg.to)) : -1;
  const stops = i0 >= 0 && i1 > i0 ? full.slice(i0, i1 + 1) : planStops;
  return { stops: stops.map(normalizeStop), full: full.map(normalizeStop), geometry: tripLeg.legGeometry || planLeg.legGeometry, realTime: tripLeg.realTime ?? planLeg.realTime };
}

const shapeOf = (g) => (g && g.points ? decodePolyline(g.points, g.precision || 6) : null);

async function trackItinerary(s) {
  stopTracking();
  showView('track');
  trackCtrl = new AbortController();
  const emoji = ICON[s.category] || ICON.other;
  $('t-icon').textContent = emoji;
  $('t-title').textContent = s.legs.map(legTitle).join(' + ');
  $('t-sub').textContent = [...new Set(s.legs.map((l) => l.agencyName).filter(Boolean))].join(', ');
  $('t-from').textContent = s.legs[0].from.name;
  $('t-to').textContent = s.legs[s.legs.length - 1].to.name;
  $('t-where').textContent = 'Cargando…';
  $('t-stops-wrap').hidden = false;
  const m = ensureMap();
  let fitted = false;

  const update = async () => {
    const trips = await Promise.all(s.legs.map((l) => (l.tripId ? getTrip(l.tripId, trackCtrl.signal).catch(() => null) : null)));
    if (trackCtrl.signal.aborted) return;
    const now = Date.now();
    const legsData = s.legs.map((l, i) => {
      const d = legStops(l, trips[i]);
      const shape = shapeOf(d.geometry);
      return { ...d, leg: l, shape, progress: computeTransitProgress(d.stops, shape, now), fullProgress: d.full && d.full.length > 1 ? computeTransitProgress(d.full, shape, now) : null };
    });
    let ci = legsData.findIndex((d) => d.progress.status !== 'arrived');
    if (ci < 0) ci = legsData.length - 1;
    const cur = legsData[ci];
    const p = cur.progress;
    const totalKm = legsData.reduce((a, d) => a + d.progress.totalKm, 0);
    const doneKm = legsData.reduce((a, d) => a + d.progress.doneKm, 0);
    const firstStop = legsData[0].stops[0];
    const lastStop = legsData[legsData.length - 1].stops.at(-1);

    setProgress((doneKm / totalKm) * 100, emoji);
    $('t-dep').textContent = `sale ${hhmm(firstStop.dep)}${firstStop.track ? ` · vía/dársena ${firstStop.track}` : ''}`;
    $('t-arr').innerHTML = `llega ${delayHtml(lastStop.arr, lastStop.schedArr)}`;
    const remaining = Math.max(0, lastStop.arr - now);
    $('t-left').textContent = now >= lastStop.arr ? 'Ha llegado' : now < firstStop.dep ? `Sale en ${formatDuration(firstStop.dep - now)}` : `Quedan ${formatDuration(remaining)}`;

    // Dónde está
    let where = p.label;
    let pos = p.position;
    let near = '';
    if (p.status === 'not_started' && cur.fullProgress && ['moving', 'at_stop'].includes(cur.fullProgress.status)) {
      where = `Viene de camino: ${cur.fullProgress.label.charAt(0).toLowerCase()}${cur.fullProgress.label.slice(1)}`;
      pos = cur.fullProgress.position;
      near = `Aún no ha llegado a ${firstStop.name}.`;
    } else if (p.status === 'not_started' && cur.fullProgress?.status === 'not_started' && cur.full?.[0]?.name !== firstStop.name) {
      near = `Todavía no ha salido de su origen (${cur.full[0].name}).`;
    }
    if (legsData.length > 1) where += ` (tramo ${ci + 1} de ${legsData.length})`;
    $('t-where').textContent = where;
    $('t-near').textContent = near;
    if (!near && (p.status === 'moving')) {
      placeName(pos.lat, pos.lon).then((n) => { if (n && !trackCtrl.signal.aborted) $('t-near').textContent = `Cerca de ${n}`; });
    }

    const live = legsData.some((d) => d.realTime);
    $('t-live').className = `badge ${live ? 'live' : ''}`;
    $('t-live').textContent = live ? 'Tiempo real' : 'Según horario';
    $('t-note').textContent = live
      ? 'La posición se calcula con los horarios en tiempo real que publica el operador (retrasos y adelantos), no con GPS del vehículo.'
      : 'Este operador no publica datos en tiempo real: la posición es una estimación según el horario programado.';

    const nextIdx = p.nextStop;
    const next = nextIdx != null ? cur.stops[nextIdx] : null;
    const delay = Math.round((lastStop.arr - lastStop.schedArr) / 60000);
    const elapsedH = Math.max(1, now - firstStop.dep) / 3600000;
    $('t-facts').innerHTML = [
      fact('Recorrido', `${fmtKm(doneKm)} de ${fmtKm(totalKm)}`),
      fact('Retraso', !isFinite(delay) ? '—' : delay >= 2 ? `<span class="late">+${delay} min</span>` : delay <= -2 ? `${delay} min` : '<span class="ontime">A su hora</span>'),
      next && p.status !== 'arrived' ? fact('Próxima parada', `${esc(next.name)} · ${hhmm(next.arr)}`) : '',
      p.status === 'moving' || p.status === 'at_stop' ? fact('Velocidad media', `${Math.round(doneKm / elapsedH)} km/h`) : '',
    ].join('');

    // Paradas
    $('t-stops').innerHTML = legsData.flatMap((d, li) => d.stops.map((st, i) => {
      const t0 = i === 0 ? st.dep : st.arr;
      const sched = i === 0 ? st.schedDep : st.schedArr;
      const passed = (i === d.stops.length - 1 ? st.arr : st.dep) <= now;
      const current = li === ci && (i === d.progress.atStop || (d.progress.atStop == null && i === d.progress.nextStop));
      return `<li class="${passed ? 'passed' : ''} ${current ? 'current' : ''}">
        <span>${esc(st.name)}${st.cancelled ? ' <span class="late">(cancelada)</span>' : ''}${li > 0 && i === 0 ? ' <small class="muted">(transbordo)</small>' : ''}</span>
        <time>${delayHtml(t0, sched)}</time></li>`;
    })).join('');

    // Mapa
    if (m) {
      layers.clearLayers();
      const all = [];
      for (const d of legsData) {
        const line = d.shape || d.stops;
        L.polyline(line.map((q) => [q.lat, q.lon]), { color: '#0f3d5e', weight: 4, opacity: 0.75 }).addTo(layers);
        for (const st of d.stops) {
          L.circleMarker([st.lat, st.lon], { radius: 4, color: '#0f3d5e', fillColor: '#fff', fillOpacity: 1, weight: 2 }).bindTooltip(st.name).addTo(layers);
          all.push([st.lat, st.lon]);
        }
      }
      L.marker([pos.lat, pos.lon], { icon: vehicleIcon(emoji) }).addTo(layers);
      all.push([pos.lat, pos.lon]);
      if (!fitted) { m.fitBounds(all, { padding: [24, 24] }); fitted = true; }
    }
    touchUpdated();
  };

  currentUpdate = update;
  try { await update(); } catch (e) { $('t-where').textContent = `No se pudo actualizar (${e.message})`; }
  trackTimer = setInterval(() => update().catch(() => {}), CONFIG.refreshSeconds * 1000);
}

// --- Vuelos

async function trackFlight(rec) {
  stopTracking();
  showView('track');
  trackCtrl = new AbortController();
  const signal = trackCtrl.signal;
  const { origin, dest } = rec;
  let s = rec.sched;
  let live = rec.live;
  let lastLookup = 0, lastSched = Date.now(), lostSince = null, fitted = false;
  const totalKm = distanceKm(origin, dest);

  $('t-icon').textContent = '✈️';
  $('t-title').textContent = s ? `${s.flightIata}${s.airline ? ' · ' + s.airline : ''}` : `${live.callsign}${live.airline ? ' · ' + live.airline : ''}`;
  $('t-from').textContent = `${origin.iata} · ${origin.city || origin.name}`;
  $('t-to').textContent = `${dest.iata} · ${dest.city || dest.name}`;
  $('t-stops-wrap').hidden = true;
  const m = ensureMap();

  const update = async () => {
    const now = Date.now();
    // 1) Horario actualizado (retrasos, puerta) cada 5 min.
    if (s && !s.usual && now - lastSched > 5 * 60000) {
      lastSched = now;
      try {
        const r = await scheduledFlights([origin], [dest], s.dep.sched - 3 * 3600000, s.dep.sched + 3 * 3600000, signal);
        s = r.flights.find((x) => x.flightIata === s.flightIata && Math.abs(x.dep.sched - s.dep.sched) < 3 * 3600000) || s;
      } catch { /* seguimos con lo que hay */ }
    }
    // 2) Posición real: si ya lo tenemos localizado, por su código; si no, lo buscamos al acercarse la hora.
    if (live) {
      try {
        const p = await refreshAircraft(live.hex, adsbProxy, signal);
        if (p && p.lat != null) { live = { ...live, ...p }; lostSince = null; } else if (!lostSince) lostSince = now;
      } catch (e) { if (e.name === 'AbortError') return; if (!lostSince) lostSince = now; }
    } else if (s && now > s.dep.real - 45 * 60000 && now < (s.arr.real ?? s.dep.real + 8 * 3600000) + 30 * 60000 && now - lastLookup > 60000) {
      lastLookup = now;
      try {
        const r = await findLiveFlights([origin], [dest], adsbProxy, signal);
        live = r.flights.find((l) => matchesLive(s, l)) || null;
      } catch { /* aún sin señal */ }
    }
    if (signal.aborted) return;

    $('t-sub').textContent = [live?.desc || live?.type || s?.aircraft, live?.reg].filter(Boolean).join(' · ');
    const depText = s ? `sale ${delayHtml(s.dep.real, s.dep.sched)}${s.depTerminal ? ` · T${esc(s.depTerminal)}` : ''}${s.depGate ? ` · puerta ${esc(s.depGate)}` : ''}` : '';
    $('t-dep').innerHTML = depText;

    let pct, pos, where, near = '', left, arrText, mode;
    if (live) {
      const pr = computeFlightProgress(origin, dest, live);
      mode = 'live';
      pct = pr.pct;
      pos = { lat: live.lat, lon: live.lon };
      left = pr.status === 'arrived' ? 'Ha llegado' : pr.status === 'not_started' ? 'En pista' : `Quedan ~${formatDuration(pr.remainingMs)}`;
      arrText = pr.status === 'arrived' ? 'aterrizado' : `llegada estimada ${hhmm(pr.arrival)}${s?.arr.sched ? ` (prevista ${hhmm(s.arr.sched)})` : ''}`;
      if (live.onGround) {
        const nearest = [origin, dest].sort((a, b) => distanceKm(a, live) - distanceKm(b, live))[0];
        where = `En tierra en el aeropuerto de ${nearest.city || nearest.name} (${nearest.iata})`;
      } else {
        where = live.altFt ? `Volando a ${Math.round(live.altFt * 0.3048).toLocaleString('es-ES')} m de altitud` : 'En vuelo';
        placeName(live.lat, live.lon).then((n) => { if (!signal.aborted) $('t-near').textContent = n ? `Sobre ${n}` : 'Sobre el mar o una zona sin nombre'; });
      }
      if (lostSince) where += ' · sin señal ahora (última posición conocida)';
      $('t-facts').innerHTML = [
        fact('Recorrido', `${fmtKm(pr.doneKm)} de ${fmtKm(pr.totalKm)}`),
        fact('Falta', fmtKm(pr.remainingKm)),
        live.speedKmh ? fact('Velocidad', `${Math.round(live.speedKmh)} km/h`) : '',
        live.altFt && !live.onGround ? fact('Altitud', `${Math.round(live.altFt * 0.3048).toLocaleString('es-ES')} m`) : '',
      ].join('');
    } else {
      const depT = s.dep.real;
      const arrT = s.arr.real ?? depT + (totalKm / 750 + 0.5) * 3600000;
      arrText = s.arr.real ? `llega ${delayHtml(s.arr.real, s.arr.sched)}` : '';
      if (s.status === 'cancelled') {
        mode = 'ground'; pct = 0; pos = origin; where = 'Vuelo cancelado'; left = '—';
      } else if (isLanded(s, now) || now >= arrT + 10 * 60000) {
        mode = 'ground'; pct = 100; pos = dest; where = `Ha aterrizado en ${dest.city || dest.name} (${dest.iata})`; left = 'Ha llegado';
      } else if (now < depT || s.status === 'scheduled') {
        mode = 'ground'; pct = 0; pos = origin;
        where = `En tierra en el aeropuerto de ${origin.city || origin.name} (${origin.iata})`;
        near = now < depT
          ? `Despegue previsto a las ${hhmm(depT)}${s.delayMin >= 5 ? ` (con ${s.delayMin} min de retraso)` : ''}.`
          : 'Debería estar despegando; aún no hay señal del avión.';
        left = now < depT ? `Sale en ${formatDuration(depT - now)}` : 'Por salir';
      } else {
        mode = 'estimate';
        const f = Math.min(1, Math.max(0, (now - depT) / (arrT - depT)));
        pct = f * 100; pos = greatCirclePoint(origin, dest, f);
        where = 'Posición estimada según el horario (aún sin señal del avión)';
        left = `Quedan ~${formatDuration(arrT - now)}`;
        placeName(pos.lat, pos.lon).then((n) => { if (!signal.aborted && n) $('t-near').textContent = `Aprox. sobre ${n}`; });
      }
      $('t-facts').innerHTML = [
        fact('Salida', `${delayHtml(s.dep.real, s.dep.sched)}`),
        s.arr.real ? fact('Llegada', delayHtml(s.arr.real, s.arr.sched)) : '',
        s.depTerminal || s.depGate ? fact('Terminal / puerta', `${esc(s.depTerminal || '—')} / ${esc(s.depGate || '—')}`) : '',
        fact('Estado', esc(s.statusText)),
        fact('Distancia', fmtKm(totalKm)),
      ].join('');
    }
    setProgress(pct, '✈️');
    $('t-where').textContent = where;
    if (near || mode === 'ground') $('t-near').textContent = near;
    $('t-left').textContent = left;
    $('t-arr').innerHTML = arrText || '';
    $('t-live').className = `badge ${mode === 'live' ? 'live' : ''}`;
    $('t-live').textContent = mode === 'live' ? 'En directo (ADS-B)' : s?.usual ? 'Horario habitual' : 'Horario en vivo';
    $('t-note').textContent = mode === 'live'
      ? 'Posición real del avión recibida por antenas ADS-B de voluntarios. La hora de llegada se estima con la distancia que falta y la velocidad actual.'
      : s?.usual
        ? 'Este vuelo sale del horario habitual de la ruta; puede no operar hoy. Cuando despegue y haya señal, verás su posición real.'
        : 'Horario, retrasos y puerta según AirLabs. Cuando el avión despegue y haya señal ADS-B, verás su posición real en el mapa.';

    if (m) {
      layers.clearLayers();
      const arc = greatCircleLine(origin, dest);
      L.polyline(arc.map((q) => [q.lat, q.lon]), { color: '#0f3d5e', weight: 3, dashArray: '6 6', opacity: 0.8 }).addTo(layers);
      for (const a of [origin, dest]) L.circleMarker([a.lat, a.lon], { radius: 6, color: '#0f3d5e', fillColor: '#fff', fillOpacity: 1 }).bindTooltip(`${a.iata} · ${a.name}`).addTo(layers);
      const rot = live?.track ?? (mode === 'estimate' ? bearingDeg(pos, dest) : 0);
      L.marker([pos.lat, pos.lon], { icon: vehicleIcon('✈️', rot - 45), opacity: mode === 'live' ? 1 : 0.6 }).addTo(layers);
      if (!fitted) { m.fitBounds([[origin.lat, origin.lon], [dest.lat, dest.lon], [pos.lat, pos.lon]], { padding: [24, 24] }); fitted = true; }
    }
    touchUpdated();
  };

  currentUpdate = update;
  $('t-near').textContent = '';
  await update();
  trackTimer = setInterval(() => update().catch(() => {}), CONFIG.refreshSeconds * 1000);
}

// ------------------------------------------------------------------- arranque
function init() {
  setupAutocomplete('from');
  setupAutocomplete('to');
  const d = new Date();
  $('date').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const last = store.get('last-search');
  if (last?.from && last?.to) {
    selected.from = last.from; selected.to = last.to;
    $('from').value = last.from.name; $('to').value = last.to.name;
    for (const i of document.querySelectorAll('input[name=mode]')) i.checked = (last.modes || []).includes(i.value);
    $('direct').checked = last.directOnly !== false;
    for (const k of ['from', 'to']) {
      for (const id of last[`${k}Choice`] || []) chosenStations[k].add(id);
      loadStations(k, true);
    }
  }

  $('search-form').addEventListener('submit', onSearch);
  $('swap').addEventListener('click', () => {
    [selected.from, selected.to] = [selected.to, selected.from];
    [$('from').value, $('to').value] = [$('to').value, $('from').value];
    [chosenStations.from, chosenStations.to] = [chosenStations.to, chosenStations.from];
    loadStations('from', true);
    loadStations('to', true);
  });
  $('results').addEventListener('click', (e) => {
    const g = e.target.closest('[data-ground]');
    const f = e.target.closest('[data-flight]');
    if (g) trackItinerary(lastGround[+g.dataset.ground]);
    else if (f) trackFlight(lastFlights[+f.dataset.flight]);
  });
  $('back').addEventListener('click', () => { stopTracking(); showView('search'); });

  // Ajustes: clave de AirLabs
  const paintKey = () => {
    const k = getAirlabsKey();
    $('airlabs-key').value = k;
    $('key-status').textContent = k ? '✅ Clave guardada: verás los vuelos programados.' : 'Sin clave: solo se ven los aviones que ya están en el aire.';
  };
  paintKey();
  $('key-save').addEventListener('click', () => { setAirlabsKey($('airlabs-key').value); paintKey(); });
  $('results').addEventListener('click', (e) => {
    if (e.target.closest('[data-open-settings]')) { $('settings').open = true; $('airlabs-key').focus(); $('settings').scrollIntoView({ behavior: 'smooth' }); }
  });
  document.addEventListener('visibilitychange', () => {
    // Al volver a la pestaña, refresca enseguida.
    if (!document.hidden && !$('track-view').hidden) currentUpdate?.().catch(() => {});
  });
}

init();

// App instalable (PWA): en el navegador se registra el service worker.
if ('serviceWorker' in navigator && !isNativeApp() && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* sin modo sin conexión */ });
}
