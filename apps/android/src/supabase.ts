import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from './config';

// IMPORTANTE: el cliente se crea de forma PEREZOSA (en el primer uso).
// createClient() llama a initialize() -> AsyncStorage.getItem() en el momento
// de construirse, y si eso ocurre al cargar el bundle en el contexto headless
// (tarea de fondo), puede crashear la app a nivel nativo.
let client: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (!isConfigured) return null;
  if (client === undefined) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: AsyncStorage,
        storageKey: 'mc-auth',
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}