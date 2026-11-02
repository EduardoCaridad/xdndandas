// Regenera data/airports.json desde OurAirports (dominio público).
// Uso: node scripts/update-airports.mjs
import { writeFile } from 'node:fs/promises';

const SRC = 'https://davidmegginson.github.io/ourairports-data/airports.csv';

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const text = await (await fetch(SRC)).text();
const [head, ...rows] = parseCsv(text);
const ix = Object.fromEntries(head.map((h, i) => [h, i]));
const airports = rows
  .filter((r) => r[ix.scheduled_service] === 'yes' && r[ix.iata_code])
  .map((r) => [
    r[ix.iata_code],
    r[ix.icao_code] || r[ix.gps_code] || r[ix.ident],
    r[ix.name],
    r[ix.municipality] || '',
    r[ix.iso_country],
    Math.round(+r[ix.latitude_deg] * 1e4) / 1e4,
    Math.round(+r[ix.longitude_deg] * 1e4) / 1e4,
    (r[ix.keywords] || '').slice(0, 80),
  ])
  .sort((a, b) => a[0].localeCompare(b[0]));

await writeFile(new URL('../data/airports.json', import.meta.url), JSON.stringify({
  source: 'OurAirports (https://ourairports.com/data/) - Public Domain',
  fields: ['iata', 'icao', 'name', 'city', 'country', 'lat', 'lon', 'keywords'],
  airports,
}));
console.log(`${airports.length} aeropuertos guardados`);
