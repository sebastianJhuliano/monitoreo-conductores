import { supabase } from './supabase';
import { getStoredDriver, setStoredDriver, StoredDriver } from './storage';

export async function signInDriver(name: string, phone: string): Promise<StoredDriver> {
  if (!supabase) throw new Error('Aplicación sin configurar');
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) {
    throw new Error('El número debe incluir el código de país. Ej: 54 11 2345 6789 → 541123456789');
  }

  const { data: anon, error: ae } = await supabase.auth.signInAnonymously();
  if (ae) throw new Error(ae.message);
  const user = anon.user;
  if (!user) throw new Error('No se pudo iniciar sesión');

  const { data: row, error: de } = await supabase
    .from('drivers')
    .insert({ auth_user_id: user.id, name: name.trim(), phone: digits })
    .select('id, name, phone')
    .single();

  if (de) {
    if (de.code === '23505') throw new Error('Ese número ya está registrado');
    throw new Error(de.message);
  }

  const driver: StoredDriver = {
    id: (row as { id: string }).id,
    name: name.trim(),
    phone: digits,
  };
  await setStoredDriver(driver);
  return driver;
}

export async function ensureDriverSession(driver: StoredDriver): Promise<StoredDriver> {
  if (!supabase) return driver;
  const { data: s } = await supabase.auth.getSession();
  if (s.session) return driver;

  const { data: anon, error: ae } = await supabase.auth.signInAnonymously();
  if (ae || !anon.user) return driver;

  const { error: rce } = await supabase.rpc('reclaim_driver', {
    p_id: driver.id,
    p_phone: driver.phone,
  });
  if (rce) {
    console.warn('reclaim_driver:', rce.message);
  }
  return driver;
}
