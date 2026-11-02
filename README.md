# xdndandas — transporte en tiempo real

<img src="icons/icon-192.png" width="96" align="right" alt="">

App **gratuita y de código abierto** para saber por dónde va un tren, un autobús o un avión. Funciona como **app de Android** (APK), como **web instalable** en Android e iPhone y en el ordenador.

👉 **Guía paso a paso para instalarla y usarla: [INSTALAR.md](INSTALAR.md)**

1. Escribe la **ciudad de origen** y la de **destino** (o una estación concreta).
2. Elige el **día** y, si quieres, el **medio de transporte**: ✈️ avión, 🚆 tren o 🚌 autobús. Si no marcas ninguno, se buscan todos.
3. Verás la lista: si es hoy, **lo que va en camino y todo lo que sale en las próximas 24 h**; si es otro día, el día completo. Con retrasos si los hay.
4. Toca uno y verás **por dónde va**: barra con el **% del recorrido**, **cuánto le queda**, el **nombre del sitio** donde está, la próxima parada y un mapa. Se actualiza solo cada 30 segundos.

No necesita registro, claves de API ni servidor de pago.

## Cómo funciona (fuentes de datos)

| Medio | Fuente | Qué da |
|---|---|---|
| 🚆 Tren y 🚌 autobús | [Transitous](https://transitous.org) (motor libre MOTIS) | Horarios oficiales abiertos (GTFS) y tiempo real (GTFS-RT) de cientos de operadores de Europa y otros países: Renfe, operadores de autobús, etc. |
| ✈️ Avión (en el aire) | [adsb.lol](https://adsb.lol) (ODbL) y [OpenSky Network](https://opensky-network.org) | Posición **real** de los aviones captada por antenas ADS-B de voluntarios, y ruta (origen/destino) de cada vuelo. |
| ✈️ Avión (programados) | [AirLabs](https://airlabs.co) (plan gratuito, uso personal, clave propia en ⚙️ Ajustes) | Vuelos que van a salir: hora, retraso, terminal y puerta (≈10 h por delante) y horario habitual de la ruta. |
| Aeropuertos | [OurAirports](https://ourairports.com/data/) | Dominio público. Copia en `data/airports.json`. |
| Mapa y nombres de lugares | [OpenStreetMap](https://www.openstreetmap.org/copyright) + [Nominatim](https://nominatim.org) | Mapa base y "cerca de…" / "sobre…". |

**Ten en cuenta:**

- **Trenes y autobuses:** la posición se **calcula** a partir de los horarios en tiempo real del operador (cuándo sale y llega a cada parada, con su retraso). No es GPS del vehículo. Si el operador no publica tiempo real, se usa el horario programado y la app lo indica ("Según horario"). La cobertura depende de qué operadores publiquen sus datos en abierto.
- **Aviones:** no existe ninguna fuente libre y sin registro con los horarios de vuelos. Sin clave, la app muestra los aviones que **están volando ahora** entre los aeropuertos de las dos ciudades, con su posición real. Con una clave gratuita de AirLabs (cada usuario pone la suya en ⚙️ Ajustes; se guarda solo en su dispositivo) añade los **vuelos programados**. Cuando uno despega, la app lo enlaza con su señal ADS-B y muestra su posición real.
- Son servicios comunitarios gestionados por voluntarios: úsalos con moderación (la app ya limita la frecuencia de peticiones).

## Ponerla en marcha

### App de Android

Cada `push` a `main` hace que GitHub Actions (`.github/workflows/android.yml`) compile el APK con [Capacitor](https://capacitorjs.com) y lo publique en **Releases**. En la app nativa las peticiones salen desde el propio móvil (CapacitorHttp), así que **los vuelos funcionan sin proxy**. Detalles en [INSTALAR.md](INSTALAR.md).

Para compilarla en tu ordenador necesitas Android Studio (con JDK 21):

```bash
npm install
npm run android:apk      # genera android/app/build/outputs/apk/debug/app-debug.apk
npm run android:open     # o ábrela en Android Studio
```

### En tu ordenador (todo funciona, incluidos los vuelos)

Necesitas [Node.js](https://nodejs.org) 22 o superior. Para usar la web no hay dependencias que instalar.

```bash
git clone https://github.com/TU-USUARIO/xdndandas.git
cd xdndandas
npm start
# abre http://localhost:8080
```

`server.js` sirve la web y hace de pequeño proxy hacia adsb.lol, que no permite llamadas directas desde el navegador (CORS).

### Publicarla gratis en GitHub Pages

1. Sube el repositorio a GitHub.
2. En **Settings → Pages → Build and deployment**, elige **GitHub Actions**. El flujo `.github/workflows/pages.yml` pasa los tests y publica la web en cada `push` a `main`.
3. Trenes y autobuses funcionan directamente. Para los **vuelos**, despliega el proxy gratuito:
   - Crea una cuenta gratis en [Cloudflare](https://dash.cloudflare.com) → *Workers & Pages* → *Create* → *Worker*.
   - Pega `worker/cloudflare-worker.js`, cambia `ALLOWED_ORIGINS` por tu URL (`https://TU-USUARIO.github.io`) y pulsa *Deploy*.
   - En `js/config.js`, pon `adsbProxy: 'https://TU-WORKER.workers.dev/proxy/adsb'`.

La web es instalable (PWA): en Chrome para Android, menú ⋮ → *Instalar aplicación*; en iPhone, Safari → Compartir → *Añadir a pantalla de inicio*.

   Sin el proxy, la app intenta usar OpenSky en modo anónimo (400 consultas al día y puede no funcionar en todos los navegadores).

## Estructura

```
index.html                 interfaz
manifest.webmanifest, sw.js  app instalable (PWA) y modo sin conexión
icons/                     icono de xdndandas
capacitor.config.json      configuración de la app nativa
android/                   proyecto de Android (Capacitor)
scripts/build-web.mjs      copia la web a www/ para la app nativa
css/styles.css             estilos (modo claro/oscuro, móvil)
js/config.js               URLs de las APIs y ajustes
js/app.js                  búsqueda, lista y pantalla de seguimiento
js/transitous.js           cliente de la API de Transitous (MOTIS 2)
js/flights.js              vuelos en directo (adsb.lol / OpenSky) y aeropuertos
js/schedules.js            vuelos programados (AirLabs) y emparejado con los vuelos en directo
js/progress.js             cálculo del % recorrido, posición y tiempo restante
js/geo.js                  distancias, rumbos, polilíneas
data/airports.json         aeropuertos con vuelos comerciales (OurAirports)
vendor/leaflet/            librería de mapas Leaflet 1.9.4 (BSD-2)
server.js                  servidor local + proxy (sin dependencias)
worker/cloudflare-worker.js  proxy para GitHub Pages (Cloudflare Workers gratis)
scripts/update-airports.mjs  regenera data/airports.json
tests/                     tests (npm test)
```

## Desarrollo

```bash
npm test                          # tests (progreso, horarios de vuelos)
node scripts/update-airports.mjs  # actualizar aeropuertos
```

Ideas para contribuir: app nativa de iOS (`npx cap add ios`, requiere Mac), notificaciones al acercarse a una parada, favoritos, compartir un seguimiento por enlace, más aerolíneas en `js/flights.js`.

Si tu operador de transporte no aparece, puedes [añadir su feed GTFS a Transitous](https://github.com/public-transport/transitous) y la app lo verá automáticamente.

## Licencia

Código: [MIT](LICENSE). Los datos pertenecen a sus fuentes y tienen sus propias licencias (ODbL para adsb.lol y OpenStreetMap, dominio público para OurAirports, las de cada operador en Transitous). Esta app es un proyecto no comercial, como exigen las condiciones de uso de Transitous y OpenSky.
