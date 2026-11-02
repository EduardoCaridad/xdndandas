// Proxy gratuito para usar la app publicada en GitHub Pages con vuelos en directo.
// Cloudflare Workers, plan gratuito (100.000 peticiones/día).
//
// 1. Crea una cuenta gratis en https://dash.cloudflare.com → Workers & Pages → Create → Worker.
// 2. Pega este archivo, cambia ALLOWED_ORIGINS por la URL de tu GitHub Pages y pulsa Deploy.
// 3. En js/config.js pon:  adsbProxy: 'https://<tu-worker>.workers.dev/proxy/adsb'

const ALLOWED_ORIGINS = [
  'https://TU-USUARIO.github.io', // ← cámbialo
  'http://localhost:8080',
];
const UPSTREAM = { adsb: 'https://api.adsb.lol', airlabs: 'https://airlabs.co' };
const ALLOWED = {
  adsb: [/^\/v2\/point\/-?[\d.]+\/-?[\d.]+\/\d+$/, /^\/v2\/hex\/[0-9a-fA-F~]{6,7}$/, /^\/v2\/callsign\/[A-Za-z0-9]{1,8}$/, /^\/api\/0\/routeset$/],
  airlabs: [/^\/api\/v9\/(schedules|routes)$/],
};

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const headers = cors(origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (url.pathname === '/proxy/health') return new Response('ok', { headers });
    const pm = url.pathname.match(/^\/proxy\/(adsb|airlabs)(\/.*)$/);
    if (!pm) return new Response('No encontrado', { status: 404, headers });
    const [, service, path] = pm;
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return new Response('Origen no permitido', { status: 403, headers });

    if (!ALLOWED[service].some((r) => r.test(path))) return new Response('Ruta no permitida', { status: 404, headers });
    if (service === 'airlabs' && request.method !== 'GET') return new Response('Método no permitido', { status: 405, headers });

    const init = {
      method: request.method,
      headers: { 'User-Agent': 'xdndandas (proyecto libre)', Accept: 'application/json' },
    };
    if (request.method === 'POST') {
      const body = await request.text();
      if (body.length > 64 * 1024) return new Response('Demasiado grande', { status: 413, headers });
      init.body = body;
      init.headers['Content-Type'] = 'application/json';
    }
    // Caché corta en el borde para las posiciones (ahorra peticiones a adsb.lol).
    const target = UPSTREAM[service] + path + (service === 'airlabs' ? url.search : '');
    // (AirLabs lleva la clave del usuario en la URL: no se guarda en caché.)
    const upstream = await fetch(target, request.method === 'GET' && service === 'adsb' ? { ...init, cf: { cacheTtl: 5 } } : init);
    const out = new Response(upstream.body, upstream);
    for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
    out.headers.set('Cache-Control', 'no-store');
    return out;
  },
};
