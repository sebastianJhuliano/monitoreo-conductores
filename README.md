# Monitoreo de Conductores

Sistema **100% gratuito** para que un equipo de transporte coordine conductores **en tiempo real** el día de la votación:

- **App Android** (los conductores): transmiten su ubicación en segundo plano (pantalla bloqueada) cada 15 s / 10 m.
- **Panel web** (el admin): mapa en vivo con todos los conductores, click en uno → abre su WhatsApp, dibuja su trayectoria, lista online/offline.

> Este README está escrito para que **otra IA o desarrollador entienda el proyecto completo desde cero**: arquitectura, tecnologías, estructura, y el **porqué** de cada decisión.

---

## 1) ¿De qué va el proyecto?

Costo total: **$0**. Stack 100% de planes gratuitos.

| Componente | Tecnología | Versión | Por qué |
|---|---|---|---|
| Mapa | Leaflet + OpenStreetMap | Leaflet 1.9 | Gratis, sin API key |
| Panel admin | React + Vite + react-leaflet | React 19, Vite 8, react-leaflet 5 | Rápido y simple |
| Hosting del panel | GitHub Pages | — | Gratis, integrado con el repo |
| Base de datos + auth + tiempo real | Supabase (free tier) | supabase-js 2.x | Gratis, realtime incluido |
| App Android | Expo / React Native | Expo SDK 57, RN 0.86 | Genera APK gratis vía CI |
| Build del APK | GitHub Actions | — | Gratis (Linux, Node 22, Java 17) |
| WhatsApp | `wa.me/<número>` | — | Manual, sin API |

### Arquitectura y flujo de datos

```
App Android (conductor)  ──REST─►  Supabase (tablas + realtime)  ──►  Panel admin (mapa)
        (inserta posiciones)                (el admin se suscribe)          (Leaflet)
```

Decisiones clave de diseño:

- **Los conductores NO abren WebSocket**: hacen llamadas REST (`report_location`). Así cientos de conductores no chocan con el límite de conexiones concurrentes del free tier de Supabase.
- **Solo el admin se suscribe a realtime** (`driver_status`): así los markers se mueven al instante sin consumir conexiones de los conductores.
- **`locations` guarda el historial** (permite dibujar trayectorias después); **`driver_status` guarda solo la última posición** (el mapa en vivo).

---

## 2) Estructura del repositorio

```
MonitoreoConductores/
├── README.md                  ← este documento
├── apps/
│   ├── web/                   PANEL ADMIN (React + Vite + Leaflet)
│   │   ├── vite.config.ts     → base '/monitoreo-conductores/' (para GitHub Pages)
│   │   ├── public/manifest.webmanifest  → PWA (instalable en el celular)
│   │   └── src/
│   │       ├── main.tsx / App.tsx            → arranque y enrutado de login/dashboard
│   │       ├── lib/supabase.ts               → cliente supabase-js (o null si no hay .env → demo)
│   │       ├── lib/demo.ts                   → datos simulados (modo demo sin backend)
│   │       ├── lib/wa.ts                     → helper de link WhatsApp (wa.me)
│   │       ├── hooks/useLiveDrivers.ts       → carga inicial + suscripción realtime + trayectorias
│   │       ├── components/Login.tsx          → login/registro del admin (email)
│   │       ├── components/Dashboard.tsx      → layout: mapa + sidebar
│   │       ├── components/MapView.tsx        → mapa Leaflet, markers, popup WhatsApp/trayectoria
│   │       ├── components/Sidebar.tsx        → lista online/offline
│   │       └── types.ts                      → tipos Driver / DriverStatus / LiveDriver
│   └── android/               APP DEL CONDUCTOR (Expo / React Native)
│       ├── app.json           → version 1.5.0, versionCode 6, package com.monitoreo.conductores
│       ├── App.tsx            → arranque: reanuda la transmisión si estaba activa (tras reiniciar el celular)
│       ├── plugins/withBootResume.js  → config plugin: receptor BOOT_COMPLETED (abre la app al prender el teléfono)
│       └── src/
│           ├── config.ts      → lee EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY (variables de entorno)
│           ├── supabase.ts    → cliente supabase-js PEREZOSO (se crea recién al usarlo; ver nota abajo)
│           ├── session.ts     → guarda/lee/refresca el token JWT y hace report_location con FETCH PLANO
│           ├── errors.ts      → reportError() guarda el error en el dispositivo Y lo manda a Supabase
│           ├── errorlog.ts    → cola de errores persistente en AsyncStorage (sobrevive a crashes)
│           ├── storage.ts     → guarda el conductor en AsyncStorage (clave 'mc_driver')
│           ├── register.ts    → sign-in ANÓNIMO + insert en drivers + reclaim_driver + guarda token
│           ├── location.ts    → TAREA DE FONDO (expo-task-manager) + foreground service
│           └── screens/
│               ├── RegisterScreen.tsx  → formulario nombre + teléfono
│               └── TrackingScreen.tsx  → transmitir/detener, permisos, stats, versión en pantalla, guía
├── supabase/
│   └── migrations/
│       ├── 0001_init.sql      → tablas, RPCs, RLS, realtime, trigger primer-admin
│       ├── 0002_app_errors.sql → tabla app_errors + RPC report_error (diagnóstico de crashes)
│       ├── 0003_app_errors_lectura_abierta.sql → el admin puede leer app_errors desde afuera
│       └── 0004_eliminar_conductor.sql → RPC delete_driver (borra conductor + historial + cuenta) + RLS
└── .github/workflows/
    ├── build-apk.yml          → compila el APK (tag v* o manual) y crea Release
    └── deploy-pages.yml       → publica el panel en GitHub Pages (push a master)
```

---

## 3) Supabase (el backend)

Proyecto actual: `https://gtgtefcifzbbdqxbzghl.supabase.co` (free tier).

### Tablas (`0001_init.sql`)

| Tabla | Para qué |
|---|---|
| `drivers` | Usuarios/conductores. `auth_user_id` vincula con `auth.users`. `is_admin` marca al admin. `phone` en formato internacional `595XXXXXXXXX` |
| `locations` | Historial de cada posición (lat, lng, accuracy, speed, heading, created_at) → trayectorias |
| `driver_status` | Última posición por conductor (1 fila por conductor) → mapa en vivo |
| `app_errors` | Registro de errores JS que manda la app (diagnóstico de crashes) |

### Funciones RPC (las llama la app)

| RPC | Qué hace | Quién la llama |
|---|---|---|
| `report_location(p_lat, p_lng, ...)` | Inserta en `locations` + hace UPSERT en `driver_status` de forma atómica. `is_moving` = velocidad > 2 m/s | La tarea de fondo de la app (con `fetch` plano + token) |
| `reclaim_driver(p_id, p_phone)` | Re-vincula un conductor ya registrado a una sesión nueva (reinstaló la app o expiró su sesión). Solo si coincide el teléfono | La app al abrir, si perdió la sesión |
| `is_admin()` | ¿El usuario logueado es admin? | Políticas RLS |
| `report_error(p_where, p_message, p_stack)` | Inserta un error JS en `app_errors` | La app cuando algo falla |

### Seguridad (RLS)

- `drivers` / `locations` / `driver_status` / `app_errors`: RLS **activo**.
- Regla general: cada usuario **solo ve/edita lo suyo**, salvo que sea **admin** (via `is_admin()`).
- El conductor inserta su propia fila en `drivers` y sus propias posiciones. El admin lee todo.
- Los RPCs son `security definer` (ejecutan con privilegios del creador) → la app no necesita permisos de tabla directos, solo ejecutar las funciones.

### Trigger

`handle_new_driver` (BEFORE INSERT en `drivers`): **el primer usuario NO anónimo** que se registre se convierte en **admin automáticamente**. Las cuentas anónimas de la app del conductor **no** se promueven (se detecta el claim `is_anonymous` del JWT).

### Realtime

```sql
alter publication supabase_realtime add table public.driver_status;
alter publication supabase_realtime add table public.locations;
```
El panel se suscribe a `driver_status` y `drivers`; `locations` se suma a la publicación por si se quiere realtime de trayectorias.

### Auth

- **Email** para el admin (panel web). Hay que **desactivar "Confirm email"** en Supabase para que el registro sea instantáneo.
- **Anonymous sign-in** para los conductores (la app no pide email/contraseña). Activado manualmente en Supabase → Authentication → Providers → Anonymous.

---

## 4) Panel web (`apps/web`)

- **Login/registro** (`Login.tsx`): el primer registro queda como admin (trigger). El panel consulta `drivers` y muestra mapa solo al admin.
- **Mapa en vivo** (`MapView.tsx`): Leaflet. **Centro por defecto: Cambyretá, Encarnación (-27.3556, -55.837)**. Cada conductor = marker con color y nombre. Popup → botón WhatsApp (`wa.me`) y "Trayectoria" (dibuja su recorrido desde `locations`).
- **Tiempo real** (`useLiveDrivers.ts`): carga inicial (`drivers` + `driver_status`) y luego escucha `postgres_changes` en `driver_status` y `drivers` → mueve los markers al instante.
- **Modo demo**: si no hay `.env`/variables configuradas, el panel corre con conductores simulados (`demo.ts`), útil para probar la UI sin backend.
- **PWA**: `manifest.webmanifest` + íconos → el admin puede "Agregar a pantalla de inicio" en el celular.

### Deploy (GitHub Pages)

Se publica en `https://sebastianJhuliano.github.io/monitoreo-conductores/` vía el workflow `deploy-pages.yml` (se dispara al pushear a `master` si cambió `apps/web`). En GitHub → Settings → Pages → Source = **GitHub Actions**.

---

## 5) App Android (`apps/android`)

APK compilado **fuera de Google Play** (no requiere publicar ni pagar). Se comparte el `.apk` una sola vez a todos los conductores.

Link permanente (siempre la última versión):
```
https://github.com/sebastianJhuliano/monitoreo-conductores/releases/latest/download/app-release.apk
```

### Flujo de la app

1. **Registro** (`RegisterScreen`): nombre + teléfono (formato `595XXXXXXXXX` para Paraguay). La app hace **sign-in anónimo** (`signInAnonymously`) e inserta su fila en `drivers` (con `auth_user_id`). Guarda el conductor en AsyncStorage (`mc_driver`).
2. **Al abrir** (`App.tsx`): limpia **todas las tareas de fondo registradas** (`TaskManager.unregisterAllTasksAsync`) para evitar que una tarea vieja de un cierre anterior crashee la app al reabrir; luego restaura la sesión (`ensureDriverSession`) y si expiró, la refresca o re-vincula con `reclaim_driver`.
3. **Transmitir** (`TrackingScreen`): pide permisos (ubicación "todo el tiempo" + activar GPS), inicia el **foreground service** con la notificación permanente "Monitoreo activo".
4. **En segundo plano** (`location.ts`): `expo-task-manager` define la tarea `mc-location-task`. Configuración: precisión **High**, cada **15 segundos / 10 metros**. Cuando Android dispara la tarea (app en primer o segundo plano), envía la posición a Supabase con **`fetch` plano** (no supabase-js).
5. **Estadísticas en vivo** (`TrackingScreen`): "Puntos enviados", precisión, velocidad, último error → visible para el usuario.

### ⚠️ Detalle importante: la tarea de fondo NO usa supabase-js

Cuando la app pasa a segundo plano, Android ejecuta la tarea en un **contexto headless** (carga un bundle JS nuevo, sin UI). Ciertos módulos nativos pueden no estar disponibles ahí y **causar crashes**. Por eso:

- La tarea (`location.ts`) importa **solo** AsyncStorage + fetch + funciones propias.
- El **token JWT** se guarda en AsyncStorage (`mc-token`) al iniciar sesión (`register.ts` → `persistSession`).
- La tarea lee el token, y si el servidor responde 401/expired, lo **refresca** vía `POST /auth/v1/token?grant_type=refresh_token` y reintenta.
- Toda esta lógica está en `src/session.ts`.

**OJO adicional (causa de crash descubierta y corregida en v1.4):** `createClient()` de supabase-js ejecuta `AsyncStorage.getItem()` **en el momento de construirse**. Si el cliente se crea al cargar el bundle en el contexto headless, la app puede crashear a nivel nativo (sin error JS visible). Por eso el cliente de `src/supabase.ts` se crea **perezosamente** (`getSupabase()`, recién al primer uso) y nunca en el arranque del bundle.

### Registro de errores (diagnóstico de crashes)

- `src/errors.ts`: `reportError(where, err)` guarda el error **en el dispositivo** (cola en AsyncStorage, `src/errorlog.ts`) Y hace `POST /rest/v1/rpc/report_error` → tabla `app_errors`.
- En el próximo arranque, `flushErrorLog()` envía los errores que quedaron guardados (sobreviven aunque el proceso muera justo después del error).
- `App.tsx`: registra un **manejador global de errores JS** (`ErrorUtils.setGlobalHandler`) + un **ErrorBoundary**.
- La tarea reporta sus propios errores (`task:error`, `send:rpc`, etc.).
- La migración `0003` abre la **lectura** de `app_errors` (solo stack traces, sin datos personales) para que cualquiera pueda consultarla desde fuera.
- **Importante para depurar**: si la app crashea y en `app_errors` no aparece nada → el crash es **nativo** (no JS).

---

## 6) GitHub Actions (CI/CD)

### `build-apk.yml` (Build APK)
- **Disparadores**: `workflow_dispatch` (botón manual en Actions) o pushear un **tag** `v*`.
- Pasos: checkout → Node 22 → Java 17 → `npm ci` → escribe `.env` desde secrets → `npx expo prebuild --platform android --no-install` → `./gradlew assembleRelease` → sube el APK como artifact → si es un tag, crea una **Release** con el APK (de ahí sale el link permanente).
- **Secrets requeridos** (Settings → Secrets → Actions):
  - `EXPO_PUBLIC_SUPABASE_URL`
  - `EXPO_PUBLIC_SUPABASE_ANON_KEY`

### `deploy-pages.yml` (Deploy panel web)
- **Disparador**: push a `master` (solo si cambió `apps/web/**`).
- Compila `apps/web` con las variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (desde los mismos secrets) y `VITE_INVITE_URL` (link del APK para el panel) → publica en GitHub Pages.

### Flujo de versiones (cómo se publica una nueva versión del APK)

1. Hacés los cambios en el código.
2. Actualizás `apps/android/app.json`: `version` (ej. `1.3.0`) y `versionCode` (número entero, se incrementa en cada build).
3. `git commit` + `git push origin master` (y `main`).
4. Creás y pusheás el tag: `git tag v1.3` + `git push origin v1.3`.
5. GitHub Actions compila (~10 min) y crea la Release → el link permanente ya apunta a la nueva versión.

> Nota: existen dos ramas (`master` y `main`) sincronizadas; los deploys miran `master`.

---

## 7) Variables de entorno

| Variable | Dónde | Para qué |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `.env` de `apps/android` (gitignored) + secret de Actions | URL del proyecto Supabase |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | igual | Clave anónima de Supabase |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | `.env` de `apps/web` + secret de Actions | Ídem para el panel |
| `VITE_INVITE_URL` | secret/`deploy-pages.yml` | Link del APK (botón "instalar app" en el panel) |

Los `.env` locales están en `.gitignore`. En la build de CI el `.env` se genera desde los secrets.

---

## 8) Construir todo desde cero (paso a paso)

### Supabase (una sola vez)
1. Crear proyecto free en supabase.com. Anotar Project URL y anon key.
2. SQL Editor → pegar `0001_init.sql` → Run. Luego `0002_app_errors.sql` → Run. Luego `0003_app_errors_lectura_abierta.sql` → Run. Luego `0004_eliminar_conductor.sql` → Run.
3. Authentication → Providers → Email: desactivar "Confirm email". Activar **Anonymous** sign-ins.
4. Dashboard → Realtime: confirmar que `driver_status` y `locations` están publicadas.

### Panel web (local)
```bash
cd apps/web
npm install
npm run dev        # http://localhost:5173 (sin .env → modo demo)
```

### App Android (local, opcional)
```bash
cd apps/android
npm install
npx expo prebuild --platform android --no-install
cd android && ./gradlew assembleRelease
# APK: android/app/build/outputs/apk/release/app-release.apk
```
En la práctica se compila en GitHub Actions (paso 6).

### GitHub (una sola vez)
1. Subir el repo a GitHub (público).
2. Crear los 2 secrets en Settings → Secrets → Actions.
3. Settings → Pages → Source: **GitHub Actions**.
4. Pushear `master` → el panel queda publicado.
5. Tag `v1.0` → se compila el primer APK y se crea la Release.

---

## 9) Flujo del día de la votación

1. El admin abre el panel (link de GitHub Pages) en su celular o PC y se loguea (o lo agrega a pantalla de inicio como PWA).
2. Cada conductor instala el APK (permitir "fuentes desconocidas"), se registra con nombre y teléfono, y toca **Empezar a transmitir**.
3. En el mapa se ven todos en vivo (punto con nombre; pulsa si está en movimiento).
4. Click en un conductor → WhatsApp para coordinar. Click en **Trayectoria** → su recorrido.
5. Dejar el celular conectado a la corriente; la notificación "Monitoreo activo" indica que sigue transmitiendo.

### Reanudación automática tras apagar/prender el celular (v1.5+)

- La app guarda si la transmisión estaba **activa** (`mc_tracking_active`).
- Un receptor nativo de arranque (`BootResumeReceiver`, agregado por el config plugin `withBootResume.js`) escucha `BOOT_COMPLETED` y **abre la app sola** cuando el teléfono termina de prender.
- Al abrirse, si la transmisión estaba activa, la app **reanuda sola** (`startTracking`). El conductor no tiene que tocar nada.
- Limitación de los fabricantes: en Samsung activar **"Permitir autoinicio"** y en Xiaomi **"Inicio automático"**, si no, el sistema puede bloquear el arranque automático.

### Configuración en el celular del conductor (IMPORTANTE, sobre todo Xiaomi/Redmi)
- Permitir ubicación **"todo el tiempo"**.
- **Desactivar la optimización de batería** para la app (el botón "Optimización de batería" de la app abre ese ajuste).
- En Xiaomi/Redmi: **Ajustes → Apps → Monitoreo Conductores → Otros permisos → Inicio automático: ACTIVADO**, y en Ajustes → Batería → restricción = **Sin restricciones**. Sin esto, Xiaomi "mata" la app y deja de transmitir.
- **No** cerrar la app desde las apps recientes ni forzarla a detenerse.

---

## 10) Problemas conocidos y depuración

### La app "se cierra sola" / crashea (SÍNTOMA PRINCIPAL ACTUAL)
- Síntoma: al instalar el APK, la app se cierra y Android muestra "Monitoreo Conductores se cerró / se bloquea con frecuencia" (los fabricantes además matan la app por batería).
- **Causa más probable (corregida en v1.4)**: `createClient()` de supabase-js tocaba AsyncStorage al cargar el bundle en el contexto headless de la tarea de fondo → crash nativo al primer evento de ubicación y, desde entonces, en cada apertura (porque la tarea queda registrada y el sistema la reactiva al arrancar el proceso).
- Defensas ya aplicadas: cliente supabase **perezoso**, tarea de fondo con `fetch` plano, limpieza de tareas viejas al abrir, manejador global de errores JS + ErrorBoundary, cola de errores persistente, permiso de notificaciones pedido en Android 13+.
- **Para diagnosticar**: consultar `app_errors` en Supabase (Table Editor) o vía REST (ahora es de lectura abierta). Si hay filas → error JS capturado (el `where_` y `stack` dicen dónde). Si NO hay filas → crash nativo y hay que sacar el log con `adb logcat *:E AndroidRuntime`.
- La app muestra su **versión en pantalla** (arriba del nombre): sirve para confirmar qué APK tiene instalado el conductor.
- **Pregunta clave que aún no está respondida**: ¿qué celular/versión de Android usa el conductor de prueba?

### Limitaciones honestas
- Si el celular mata la app (Xiaomi/Samsung agresivos) el tracking se corta. El foreground service lo mitiga pero no es infalible.
- iOS no se puede publicar sin pagar ($99/año de Apple); el tracking de fondo de verdad es solo Android.
- Dentro de edificios la precisión GPS baja.

---

## 11) Ideas futuras (ya contempladas en el diseño)

- Trayectoria coloreada por velocidad (los puntos ya guardan `speed`).
- Alertas: conductor detenido X minutos / offline.
- Exportar reporte del día (CSV/PDF).
- Zonas/geofencing: avisar si un conductor sale del radio de su centro de votación.
