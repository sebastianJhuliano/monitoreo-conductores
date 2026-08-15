# Monitoreo de Conductores

Sistema para que un equipo de transporte coordine conductores en tiempo real el día de la votación.

- **Panel admin (web)**: mapa con la ubicación en vivo de todos los conductores, click en un conductor → abre su WhatsApp, trayectoria dibujada, lista online/offline.
- **App Android**: el conductor se registra (nombre + teléfono), activa la transmisión y la ubicación sigue viajando **en segundo plano** (pantalla bloqueada) gracias a un *foreground service*.
- **Costo total: $0.** Stack 100% gratuito.

## Arquitectura

| Componente | Tecnología | Costo |
|---|---|---|
| Mapa + markers | Leaflet + OpenStreetMap | $0 |
| Panel admin | React + Vite | $0 |
| Hosting panel | Cloudflare Pages | $0 |
| DB + tiempo real + auth | Supabase (free tier) | $0 |
| App Android | Expo / React Native | $0 |
| Build APK | GitHub Actions | $0 |
| WhatsApp | `wa.me/<número>` (manual) | $0 |

```
App Android (conductor)  ──REST/WebSocket──►  Supabase (tablas + realtime)  ──►  Panel admin (mapa)
```

- El conductor **no** abre WebSocket: hace inserts REST (`report_location`). Así, cientos de conductores no chocan contra el límite de conexiones concurrentes del free tier.
- Solo el **admin** se suscribe en tiempo real (`driver_status`), moviendo los markers al instante.
- La tabla `locations` guarda el historial → permite dibujar la trayectoria.

## Estructura

```
apps/
  web/        Panel de administración (React + Vite + Leaflet)
  android/    App del conductor (Expo/React Native, tracking en 2º plano)
supabase/
  migrations/ Schema SQL (tablas, RLS, realtime)
.github/
  workflows/  Build del APK en GitHub Actions
```

---

## 1) Supabase (una sola vez)

1. Creá una cuenta en [supabase.com](https://supabase.com) y un proyecto nuevo (plan **Free**). Anotá la contraseña de la base de datos.
2. Andá a **SQL Editor** → New query → pegá el contenido de `supabase/migrations/0001_init.sql` → **Run**. Esto crea tablas, políticas de seguridad (RLS) y el realtime.
3. **Authentication → Sign In / Up → Email → Providers → Email → desactivá "Confirm email"** (así el admin puede crear su cuenta al instante).
4. **Project Settings → API**: copiá la **Project URL** y la **anon public key**.

> Nota: el **primer usuario** que se registre en el panel web se convierte en **admin** automáticamente. Registrate vos primero (y repartí el APK después). Si algo falla, promové manualmente con:
> `update public.drivers set is_admin = true where id = '<tu driver id>';`

## 2) Panel admin (web)

```bash
cd apps/web
cp .env.example .env     # pegá los valores de Supabase
npm install
npm run dev              # http://localhost:5173
```

- **Sin** `.env` configurado, el panel corre en **modo demo** (conductores simulados moviéndose), ideal para probar la UI.
- Con Supabase conectado: registrá la primera cuenta (queda como admin) → ves el mapa real.
- Cada conductor aparece como un punto de color con su nombre. Click → popup con **WhatsApp** (abre el chat) y **Trayectoria** (dibuja su recorrido).

### Deploy gratis a Cloudflare Pages

1. Subí el repo a GitHub.
2. En Cloudflare Pages → **Create project** → conectá el repo.
3. Build command: `cd apps/web && npm install && npm run build` — Build output: `apps/web/dist`.
4. En **Settings → Environment variables**: `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (además de `VITE_INVITE_URL` con el link del APK, si querés).

## 3) App Android (conductores)

### Compilar el APK (gratis, vía GitHub Actions)

1. Subí el repo a GitHub.
2. **Settings → Secrets and variables → Actions** → creá dos secretos:
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
3. **Actions → Build APK → Run workflow** (o pusheá un tag `v1.0` para generar además una Release con el APK descargable).
4. Bajá el APK de los artifacts / release. Ese APK se comparte **una sola vez** a todos los conductores.

### Probar en local (opcional)

```bash
cd apps/android
cp .env.example .env     # pegá los valores de Supabase
npm install
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease
# APK en android/app/build/outputs/apk/release/app-release.apk
```

### Instrucciones para los conductores

- Instalar el APK (permitir instalación de fuentes desconocidas).
- Abrir la app → **Registrarse** con nombre y número de WhatsApp (con código de país, ej: `541123456789`).
- Tocar **Empezar a transmitir**.
- Cuando Android pregunte por la ubicación: elegir **"Permitir todo el tiempo"**.
- Activar el botón **Optimización de batería** (evita que el celular mate la transmisión).
- **No** cerrar la app desde las apps recientes. La notificación permanente "Monitoreo activo" indica que sigue transmitiendo.

> iOS: no se puede publicar sin pagar ($99/año de Apple). Para un iPhone puntual se puede usar el panel web con Wake Lock, pero el tracking de fondo de verdad es solo Android.

## 4) Flujo del día de la votación

1. El admin abre el panel web (link de Cloudflare) y se loguea.
2. Cada conductor abre la app, se registra y toca **Empezar a transmitir**.
3. En el mapa se ven todos en vivo (punto con nombre, pulsa si está en movimiento).
4. Click en un conductor → WhatsApp para coordinar.
5. Click en **Trayectoria** → su recorrido dibujado (guardado en `locations`).

## Ideas futuras (ya contempladas en el diseño)

- Trayectoria coloreada por velocidad (los puntos ya guardan `speed`).
- Alertas: conductor detenido X minutos / offline.
- Exportar reporte del día (CSV/PDF).
- Zonas (geofencing): avisar cuando un conductor sale del radio de su centro de votación.

## Limitaciones honestas

- Si el conductor **cierra la app** (o el celular la mata) el tracking se corta. El *foreground service* mitiga esto, pero no es infalible contra fabricantes agresivos (Xiaomi, Samsung, etc.).
- La app usa ubicación aproximada/real según GPS; adentro de edificios la precisión baja.
- El plan free de Supabase alcanza de sobra para ~200 conductores con estos ajustes de frecuencia.
