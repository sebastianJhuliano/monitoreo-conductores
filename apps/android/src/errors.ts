import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from './config';
import { pushErrorLog } from './errorlog';

function postError(where: string, message: string, stack: string): void {
  if (!isConfigured) return;
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

export function reportError(where: string, err: unknown, extra?: string): void {
  const message = err instanceof Error ? err.message : String(err ?? '');
  const stack = err instanceof Error ? err.stack ?? '' : '';
  // 1) Guardar en el dispositivo primero: si el proceso muere antes de poder
  //    mandar el POST, el error queda para el próximo arranque.
  pushErrorLog(where, message, stack);
  // 2) Intentar mandar ahora mismo (fire-and-forget).
  postError(where, message, extra ?? stack);
}

export function flushErrorLog(): void {
  import('./errorlog').then(async ({ takeErrorLog }) => {
    const entries = await takeErrorLog();
    for (const e of entries) {
      postError(e.w, e.m, e.s);
    }
  });
}