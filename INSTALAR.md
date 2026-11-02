# Cómo instalar y usar xdndandas

Esta guía va de cero a tener **xdndandas** instalada en tu móvil Android. No hace falta saber programar ni pagar nada.

Resumen: subes el proyecto a GitHub → GitHub fabrica la app de Android (el APK) y publica la web → la descargas en el móvil.

---

## 1. Crea una cuenta en GitHub (si no la tienes)

Entra en <https://github.com/signup> y regístrate. Es gratis.

## 2. Sube el proyecto a GitHub

La forma más fácil es con **GitHub Desktop** (Windows o Mac):

1. Descarga e instala GitHub Desktop: <https://desktop.github.com>. Inicia sesión con tu cuenta.
2. Descomprime `xdndandas.zip` en una carpeta, por ejemplo `Documentos/xdndandas`.
3. En GitHub Desktop: **File → Add local repository…** y elige esa carpeta.
4. Te dirá que no es un repositorio. Pulsa **create a repository** y luego **Create repository**.
5. Pulsa **Publish repository**:
   - Nombre: `xdndandas`
   - **Desmarca** «Keep this code private». Tiene que ser público para que GitHub compile y publique gratis.
   - Pulsa **Publish repository**.

> También puedes subirlo arrastrando los archivos en la web de GitHub, pero muchos ordenadores ocultan la carpeta `.github`, que es imprescindible. Por eso es mejor GitHub Desktop.

## 3. Activa la web y la compilación automática

En la página de tu repositorio (`https://github.com/TU-USUARIO/xdndandas`):

1. **Settings → Pages → Build and deployment → Source:** elige **GitHub Actions**.
2. **Settings → Actions → General → Workflow permissions:** marca **Read and write permissions** y guarda.
3. Ve a la pestaña **Actions**. Verás dos procesos:
   - **App de Android (APK)**: tarda unos 5 minutos.
   - **Web en GitHub Pages**: si salió en rojo porque se ejecutó antes de activar Pages, entra en él y pulsa **Re-run all jobs**.

Cuando los dos estén en verde ✅:

- La app de Android está en **Releases** (columna derecha de la página del repositorio), como `xdndandas.apk`.
- La web está en `https://TU-USUARIO.github.io/xdndandas/`.

## 4. Instala la app en tu Android

### Opción A — App de verdad (APK), recomendada

1. En el móvil, abre Chrome y entra en `https://github.com/TU-USUARIO/xdndandas/releases`.
2. Toca **xdndandas.apk** para descargarlo.
3. Abre el archivo descargado (desde la notificación o desde la app *Archivos* → *Descargas*).
4. Si Android avisa de que Chrome no tiene permiso para instalar apps: toca **Ajustes** → activa **Permitir de esta fuente** → vuelve atrás.
5. Toca **Instalar**. Si Google Play Protect dice que no conoce la app, elige **Más detalles → Instalar de todas formas**. Es normal en apps que no vienen de la Play Store.

El icono de **xdndandas** aparecerá con tus aplicaciones. En esta versión funcionan trenes, autobuses y aviones en el aire sin configurar nada más. Para ver también los **vuelos que van a salir**, sigue el paso 4 bis.

### 4 bis. Clave gratuita para los vuelos programados (2 minutos, una sola vez)

No existe ninguna fuente libre y sin registro con los horarios de los vuelos, así que la app usa el plan gratuito de **AirLabs** (uso personal, sin tarjeta):

1. Entra en <https://airlabs.co/signup> y crea una cuenta gratis.
2. En tu panel de AirLabs, copia tu **API Key**.
3. En xdndandas, abre **⚙️ Ajustes** (debajo del botón Buscar), pega la clave y pulsa **Guardar**.

La clave se guarda solo en tu móvil. El plan gratuito da unas 1.000 consultas al mes, y cada búsqueda de vuelos gasta entre 2 y 4. La app guarda los resultados unos minutos para no gastar de más.

Sin clave, la app sigue mostrando los aviones que están volando ahora.

### Opción B — Instalarla desde la web (sin APK)

1. En el móvil, abre Chrome y entra en `https://TU-USUARIO.github.io/xdndandas/`.
2. Menú **⋮** → **Instalar aplicación** (o **Añadir a pantalla de inicio**).

Trenes y autobuses funcionan igual. Para los **vuelos** en esta versión web hay que montar un pequeño proxy gratuito (ver el README, apartado «Publicarla gratis en GitHub Pages»).

## 5. Cómo se usa

1. **Origen** y **Destino**: empieza a escribir y elige una sugerencia.
   - 📍 **Ciudad**: debajo aparecen **sus estaciones**, de tren (🚆) y de autobús (🚌). Con **Todas** marcado se busca desde las principales. Toca una o varias para buscar solo desde esas; por ejemplo, solo Chamartín y no Atocha. Vuelve a tocar **Todas** para quitar la selección.
   - 🚉 **Estación concreta**: busca solo desde esa estación.
2. **Día**: por defecto, hoy.
3. **Medio de transporte**: ✈️ Avión, 🚆 Tren, 🚌 Autobús. Puedes marcar varios. **Si no marcas ninguno, busca todos.** Cada medio sale en su propia sección y nunca se mezclan: en «Trenes» solo hay trayectos en tren (desde las estaciones de tren de la ciudad), y en «Autobuses» solo en autobús (desde las estaciones de autobús).
4. **Solo directos**: déjalo marcado para ver solo trayectos sin transbordos. Desmárcalo si no aparece nada.
5. Pulsa **Buscar**.
   - **Si el día es hoy**, la lista muestra lo que **va en camino ahora** y todo lo que **sale en las próximas 24 horas**, aunque pase a mañana.
   - **Si eliges otro día**, muestra ese día completo.

   En la lista:
   - La hora en **rojo** con la prevista ~~tachada~~ indica retraso.
   - «En camino» / «En vuelo · 45 %», «Sale en 25 min», «Programado».
   - En los vuelos: terminal y puerta cuando se conocen, y «horario habitual» si es un vuelo que suele operar a esa hora pero aún no está confirmado.
   - 📡 indica que el operador publica datos en tiempo real.
6. **Toca uno** para seguirlo:
   - **Barra de progreso** con el % recorrido y el tiempo que falta.
   - **Dónde está ahora**: «Entre Santiago y Ourense, cerca de Silleda», «Detenido en Zamora», «Volando a 11.000 m sobre Castilla y León»…
   - Si el vuelo **aún no ha despegado**: «En tierra en el aeropuerto de A Coruña · Despegue previsto a las 20:36 (con 25 min de retraso)». En cuanto despega y hay señal, pasa solo a mostrar su **posición real**.
   - Retraso, próxima parada, velocidad, mapa y lista de paradas.
   - Se actualiza sola cada 30 segundos.
7. **← Volver a la lista** para elegir otro.

La app recuerda tu última búsqueda.

**Limitaciones:**

- **Trenes y autobuses**: la posición se calcula con los horarios en tiempo real del operador; no es el GPS del vehículo. Si el operador no publica tiempo real, verás «Según horario».
- **Aviones**: sin clave de AirLabs solo aparecen los que están volando **ahora**. Con clave, los horarios en vivo (con retrasos y puerta) cubren unas **10 horas** por delante; el resto de las 24 horas se completa con el «horario habitual» de la ruta, si AirLabs lo da en el plan gratuito.
- Si una ruta no aparece, puede que esa empresa no publique sus horarios en abierto.

## 6. Cómo actualizar la app

1. Cambia lo que quieras en los archivos de la carpeta.
2. En GitHub Desktop: escribe un resumen abajo a la izquierda → **Commit to main** → **Push origin**.
3. A los ~5 minutos tendrás un APK nuevo en **Releases**. Instálalo encima del anterior: no hace falta desinstalar y no pierdes nada.

## 7. Probarla en el ordenador (opcional)

Instala [Node.js](https://nodejs.org) 22 o superior. Abre una terminal en la carpeta del proyecto y escribe:

```bash
npm start
```

Luego abre <http://localhost:8080>. En el ordenador también funciona todo, vuelos incluidos.

## 8. ¿Y en iPhone?

- **Ya mismo, sin hacer nada más:** en el iPhone, abre `https://TU-USUARIO.github.io/xdndandas/` con **Safari** → botón **Compartir** → **Añadir a pantalla de inicio**. Queda como una app con su icono.
- **App nativa para iOS:** es el siguiente paso. El proyecto ya está preparado (Capacitor), pero Apple obliga a compilar en un **Mac con Xcode**. Para publicarla en la App Store hace falta además una cuenta de desarrollador de Apple, que es de pago.

## Problemas frecuentes

| Problema | Solución |
|---|---|
| No hay nada en **Releases** | Pestaña **Actions** → mira si «App de Android (APK)» está en rojo. Comprueba el paso 3.2 (permisos) y pulsa **Re-run all jobs**. |
| «App no instalada» al actualizar | Desinstala la versión anterior y vuelve a instalar. Solo pasa si el APK se compiló con otra firma. |
| No salen resultados | Mira qué estaciones ha usado (aparecen encima de la lista). Si no son las buenas, toca la estación que quieras debajo del origen o destino. También puedes desmarcar **Solo directos** o comprobar la fecha. |
| No salen los vuelos que van a salir | Añade la clave de AirLabs en ⚙️ Ajustes (paso 4 bis). En la versión web (opción B) hace falta además el proxy. |
| «Se ha agotado la cuota gratuita de este mes» | Has gastado las consultas gratis de AirLabs. Se renuevan el mes siguiente. |
| El mapa sale gris | Revisa la conexión a internet. |

## Nota sobre la firma del APK

El APK se firma con la clave `android/app/xdndandas.keystore`, incluida en el proyecto. Así cada versión nueva se instala encima de la anterior. Para uso personal está bien. **Si algún día la subes a Google Play**, crea tu propia clave privada, guárdala en los *Secrets* de GitHub y no la subas al repositorio.
