import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { loadToken, refreshToken, reportLocation, saveToken, type Point } from './session';
import { clearStoredDriver } from './storage';
import { reportError } from './errors';

export const LOCATION_TASK = 'mc-location-task';

// Precisión máxima aceptada para mover el marcador (radio de error del GPS).
export const MAX_ACCURACY_M = 100;
// Movimiento mínimo para guardar un punto nuevo (filtra el "ruido" del GPS
// cuando el conductor está quieto: sin esto, parado parece que camina).
export const MIN_MOVE_M = 25;
// Velocidad imposible en ciudad (>40 m/s = 144 km/h): el GPS entregó una
// posición "fantasma" (antena/WiFi), no un auto real. Se descarta sin mover.
export const MAX_SPEED_MPS = 40;

export interface LastFix {
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;
  at: number;
}

export interface TrackingStats {
  lastFix: LastFix | null;
  sentCount: number;
  lastError: string | null;
}

let lastFix: LastFix | null = null;
let sentCount = 0;
let lastError: string | null = null;
// Último punto REAL enviado: sirve para no insertar puntos por jitter.
let lastSent: { lat: number; lng: number } | null = null;
// Momento del último punto real enviado: sirve para detectar saltos por
// velocidad implícita (distancia / tiempo) aunque el GPS no reporte speed.
let lastSentAt = 0;

export function getStats(): TrackingStats {
  return { lastFix, sentCount, lastError };
}

function distM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(x));
}

async function sendPoint(loc: Location.LocationObject): Promise<void> {
  const token = await loadToken();
  if (!token) {
    lastError = 'sesión no disponible';
    return;
  }
  const acc = loc.coords.accuracy ?? null;
  const speed = loc.coords.speed ?? null;
  const lat = loc.coords.latitude;
  const lng = loc.coords.longitude;

  let hasFix = true;
  let update = true;
  if (acc !== null && acc > MAX_ACCURACY_M) {
    // GPS malo (antenas/WiFi, error de cientos de metros): no mover el
    // marcador, solo avisar que seguimos conectados.
    hasFix = false;
    update = false;
  } else if (speed !== null && speed > MAX_SPEED_MPS) {
    // Velocidad reportada por el dispositivo absurda: es un error de GPS,
    // no un auto real. Mantener online sin mover el marcador.
    update = false;
  } else if (lastSent) {
    const d = distM(lastSent.lat, lastSent.lng, lat, lng);
    const dt = (Date.now() - lastSentAt) / 1000;
    if (d < MIN_MOVE_M || (acc !== null && d < acc)) {
      // Ruido del GPS: movimiento menor al mínimo o menor al radio de error
      // del GPS (estando quieto "camina" 25-100 m). Refrescar estado sin
      // punto nuevo: estando parado no se deben sumar km.
      update = false;
    } else if (dt > 0 && d / dt > MAX_SPEED_MPS) {
      // Salto imposible: demasiada distancia para el tiempo transcurrido
      // (aunque el GPS diga que la precisión es buena). No mover.
      update = false;
    }
  }

  const params: Point = {
    p_lat: lat,
    p_lng: lng,
    p_accuracy: acc,
    p_speed: loc.coords.speed,
    p_heading: loc.coords.heading,
    p_has_fix: hasFix,
    p_update: update,
  };
  let res = await reportLocation(token, params);
  if (!res.ok && /401|jwt|expired|invalid|PGRST301/i.test(res.err)) {
    const next = await refreshToken(token);
    if (!next) {
      lastError = 'sesión expirada';
      reportError('send:session', new Error(res.err));
      return;
    }
    res = await reportLocation(next, params);
    if (!res.ok) {
      lastError = res.err;
      reportError('send:retry', new Error(res.err));
      return;
    }
  } else if (!res.ok) {
    // El conductor ya no existe (lo borró el admin): limpiar para que
    // al reabrir la app aparezca la pantalla de registro.
    if (/no registrado/i.test(res.err)) {
      lastError = 'Tu cuenta fue eliminada por el administrador';
      reportError('send:deleted', new Error(res.err));
      await clearStoredDriver();
      await saveToken(null);
      return;
    }
    lastError = res.err;
    reportError('send:rpc', new Error(res.err));
    return;
  }
  lastFix = {
    lat,
    lng,
    accuracy: acc,
    speed: loc.coords.speed,
    at: Date.now(),
  };
  if (hasFix && update) {
    lastSent = { lat, lng };
    lastSentAt = Date.now();
  }
  sentCount += 1;
  lastError = null;
}

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    lastError = error.message;
    reportError('task:error', error);
    return;
  }
  const locations = (data as { locations?: Location.LocationObject[] })?.locations;
  if (!locations || locations.length === 0) return;
  for (const loc of locations) {
    try {
      await sendPoint(loc);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      reportError('task:sendPoint', err);
    }
  }
});

export async function startTracking(): Promise<void> {
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.Highest,
    distanceInterval: 10,
    timeInterval: 15_000,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: 'Monitoreo activo',
      notificationBody: 'Transmitiendo tu ubicación al centro de monitoreo',
      notificationColor: '#2563eb',
      killServiceOnDestroy: false,
    },
  });
}

export async function stopTracking(): Promise<void> {
  await Location.stopLocationUpdatesAsync(LOCATION_TASK);
}

export async function isTracking(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
}
