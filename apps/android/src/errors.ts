import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from './config';

export function reportError(where: string, err: unknown, extra?: string): void {
  if (!isConfigured) return;
  const message = err instanceof Error ? err.message : String(err ?? '');
  const stack = err instanceof Error ? err.stack ?? '' : '';
  try {
    fetch(`${SUPABASE_URL}/rest/v1/rpc/report_error`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        p_where: where,
        p_message: message,
        p_stack: stack,
      }),
    }).catch(() => {});
  } catch {
    // nunca romper por intentar reportar
  }
}
