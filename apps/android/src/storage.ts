import AsyncStorage from '@react-native-async-storage/async-storage';

export interface StoredDriver {
  id: string;
  name: string;
  phone: string;
}

const KEY = 'mc_driver';

export async function getStoredDriver(): Promise<StoredDriver | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDriver;
    if (!parsed.id || !parsed.name) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function setStoredDriver(d: StoredDriver): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(d));
}
