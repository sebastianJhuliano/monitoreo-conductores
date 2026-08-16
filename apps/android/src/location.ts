import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { loadToken, refreshToken, reportLocation } from './session';
import { reportError } from './errors';

export const LOCATION_TASK = 'mc-location-task';

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

export function getStats(): TrackingStats {
  return { lastFix, sentCount, lastError };
}

async function sendPoint(loc: Location.LocationObject): Promise<void> {
  const token = await loadToken();
  if (!token) {
    lastError = 'sesión no disponible';
    return;
  }
  const params = {
    p_lat: loc.coords.latitude,
    p_lng: loc.coords.longitude,
    p_accuracy: loc.coords.accuracy,
    p_speed: loc.coords.speed,
    p_heading: loc.coords.heading,
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
    lastError = res.err;
    reportError('send:rpc', new Error(res.err));
    return;
  }
  lastFix = {
    lat: loc.coords.latitude,
    lng: loc.coords.longitude,
    accuracy: loc.coords.accuracy,
    speed: loc.coords.speed,
    at: Date.now(),
  };
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
    accuracy: Location.Accuracy.High,
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
