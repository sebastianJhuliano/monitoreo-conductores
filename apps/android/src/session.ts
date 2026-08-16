import AsyncStorage from '@react-native-async-storage/async-storage';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';

const KEY = 'mc-token';

export interface StoredToken {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export async function saveToken(token: StoredToken | null): Promise<void> {
  try {
    if (token) {
      await AsyncStorage.setItem(KEY, JSON.stringify(token));
    } else {
      await AsyncStorage.removeItem(KEY);
    }
  } catch {
    // nunca romper por guardar el token
  }
}

export async function loadToken(): Promise<StoredToken | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as StoredToken;
    if (!t.access_token) return null;
    return t;
  } catch {
    return null;
  }
}

export async function refreshToken(token: StoredToken): Promise<StoredToken | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ refresh_token: token.refresh_token }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const next: StoredToken = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
    await saveToken(next);
    return next;
  } catch {
    return null;
  }
}

export interface Point {
  p_lat: number;
  p_lng: number;
  p_accuracy: number | null;
  p_speed: number | null;
  p_heading: number | null;
}

export async function reportLocation(
  token: StoredToken,
  point: Point,
): Promise<{ ok: boolean; err: string }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/report_location`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token.access_token}`,
      },
      body: JSON.stringify(point),
    });
    if (res.ok) return { ok: true, err: '' };
    return { ok: false, err: `${res.status}: ${(await res.text()).slice(0, 200)}` };
  } catch (e) {
    return { ok: false, err: e instanceof Error ? e.message : String(e) };
  }
}
