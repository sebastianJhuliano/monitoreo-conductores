import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'mc_errlog';
const MAX = 20;

export interface ErrEntry {
  t: number;
  w: string;
  m: string;
  s: string;
}

export async function pushErrorLog(where: string, message: string, stack?: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list: ErrEntry[] = raw ? JSON.parse(raw) : [];
    list.push({
      t: Date.now(),
      w: where.slice(0, 40),
      m: message.slice(0, 500),
      s: stack ? stack.slice(0, 1500) : '',
    });
    while (list.length > MAX) list.shift();
    await AsyncStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // nunca romper por guardar el log
  }
}

export async function takeErrorLog(): Promise<ErrEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    await AsyncStorage.removeItem(KEY);
    return JSON.parse(raw) as ErrEntry[];
  } catch {
    return [];
  }
}