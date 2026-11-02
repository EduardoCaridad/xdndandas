// Configuración de la app. Todo lo que hay aquí es gratuito y no necesita claves.
export const CONFIG = {
  // API de Transitous (MOTIS 2): trenes, autobuses y otros transportes públicos
  // con horarios abiertos (GTFS) y tiempo real (GTFS-RT) cuando el operador lo publica.
  // Política de uso: https://transitous.org/api/  (proyecto libre, sin ánimo de lucro)
  transitousBase: 'https://api.transitous.org',
  // Versiones de la API que se prueban en orden (la primera que responda se usa).
  transitousVersions: ['v5', 'v6'],

  // Vuelos en directo (ADS-B). adsb.lol no envía cabeceras CORS, así que el navegador
  // necesita un pequeño proxy. Si sirves la app con `npm start` (server.js) el proxy
  // está en el mismo origen: '/proxy/adsb'. Si la publicas en GitHub Pages, despliega
  // worker/cloudflare-worker.js (gratis) y pon aquí su URL, p. ej.
  // 'https://xdndandas-proxy.tu-usuario.workers.dev/proxy/adsb'.
  // Déjalo en '' para usar solo OpenSky en modo anónimo (puede fallar por CORS/límites).
  adsbProxy: 'auto',

  // OpenSky Network (respaldo para vuelos, acceso anónimo con 400 créditos/día).
  openskyBase: 'https://opensky-network.org/api',

  // Geocodificación inversa (nombre del sitio donde está un avión). Nominatim/OSM.
  // Política: máx. 1 petición/segundo. La app solo pide una cada 30 s como mucho.
  nominatimBase: 'https://nominatim.openstreetmap.org',

  // Vuelos programados (AirLabs, plan gratuito de uso personal). Lo normal es que cada
  // usuario pegue su clave en «Ajustes» dentro de la app (se guarda solo en su móvil).
  // No pongas aquí tu clave si el repositorio es público.
  airlabsKey: '',

  // Cada cuántos segundos se actualiza la posición del vehículo seguido.
  refreshSeconds: 30,

  // Radio (km) alrededor de la ciudad para buscar aeropuertos.
  airportRadiusKm: 70,

  // Minutos máximos andando hasta/desde la estación cuando eliges una ciudad
  // (no una estación concreta).
  maxWalkMinutes: 40,
};

/** ¿Estamos dentro de la app nativa (APK de Android / app de iOS hecha con Capacitor)? */
export const isNativeApp = () => !!window.Capacitor?.isNativePlatform?.();

// Resuelve 'auto': usa el proxy local si la app se sirve con server.js.
export async function resolveAdsbProxy() {
  // En la app nativa las peticiones las hace el móvil (CapacitorHttp), sin límites de CORS:
  // se habla directamente con adsb.lol y no hace falta ningún proxy.
  if (isNativeApp()) return 'https://api.adsb.lol';
  if (CONFIG.adsbProxy !== 'auto') return CONFIG.adsbProxy;
  try {
    const r = await fetch('/proxy/health', { cache: 'no-store' });
    if (r.ok) return '/proxy/adsb';
  } catch { /* no hay proxy local */ }
  return '';
}
