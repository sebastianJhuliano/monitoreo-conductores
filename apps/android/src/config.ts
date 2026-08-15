const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const SUPABASE_URL = url.trim();
export const SUPABASE_ANON_KEY = anon.trim();
export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
