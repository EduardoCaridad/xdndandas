// Servidor local sin dependencias: sirve la app y hace de proxy para adsb.lol y AirLabs
// (el navegador no puede llamarlos directamente por CORS; la app de Android sí).
// Uso:  npm start   →  http://localhost:8080
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const UPSTREAM = { adsb: 'https://api.adsb.lol', airlabs: 'https://airlabs.co' };
const USER_AGENT = 'xdndandas (proyecto libre)';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

// Solo se reenvían estas rutas de adsb.lol.
const ALLOWED = {
  adsb: [/^\/v2\/point\/-?[\d.]+\/-?[\d.]+\/\d+$/, /^\/v2\/hex\/[0-9a-fA-F~]{6,7}$/, /^\/v2\/callsign\/[A-Za-z0-9]{1,8}$/, /^\/api\/0\/routeset$/],
  airlabs: [/^\/api\/v9\/(schedules|routes)$/],
};

async function proxy(req, res, service, path, search) {
  if (!ALLOWED[service]?.some((r) => r.test(path))) return send(res, 404, 'Ruta no permitida');
  if (service === 'airlabs' && req.method !== 'GET') return send(res, 405, 'Método no permitido');
  let body;
  if (req.method === 'POST') {
    const chunks = [];
    let size = 0;
    for await (const c of req) { size += c.length; if (size > 64 * 1024) return send(res, 413, 'Demasiado grande'); chunks.push(c); }
    body = Buffer.concat(chunks);
  }
  try {
    const r = await fetch(UPSTREAM[service] + path + (search || ''), {
      method: req.method,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body,
      signal: AbortSignal.timeout(20000),
    });
    res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' });
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    send(res, 502, `Error contactando con ${service}: ${e.message}`);
  }
}

function send(res, code, text) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/proxy/health') return send(res, 200, 'ok');
  const pm = url.pathname.match(/^\/proxy\/(adsb|airlabs)(\/.*)$/);
  if (pm) return proxy(req, res, pm[1], pm[2], pm[1] === 'airlabs' ? url.search : '');
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método no permitido');

  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path.endsWith('/')) path += 'index.html';
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT) || /[/\\]\.|node_modules|server\.js/.test(path)) return send(res, 404, 'No encontrado');
  try {
    if (!(await stat(file)).isFile()) throw new Error();
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : await readFile(file));
  } catch {
    send(res, 404, 'No encontrado');
  }
});

server.listen(PORT, () => console.log(`xdndandas funcionando en http://localhost:${PORT}`));
