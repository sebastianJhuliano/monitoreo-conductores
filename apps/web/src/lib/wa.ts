export function waLink(phone: string, text?: string): string {
  const digits = phone.replace(/\D/g, '');
  const base = `https://wa.me/${digits}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

// Muestra el número como lo conoce el conductor: 595982362830 → 0982 362 830
export function formatPhone(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('595') && digits.length === 12) {
    digits = '0' + digits.slice(3);
  } else if (digits.length === 9) {
    digits = '0' + digits;
  }
  const a = digits.slice(0, 4);
  const b = digits.slice(4, 7);
  const c = digits.slice(7, 10);
  return [a, b, c].filter(Boolean).join(' ');
}

export function timeAgo(iso: string | null): string {
  if (!iso) return 'sin datos';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 10_000) return 'ahora';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `hace ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m}min`;
  const h = Math.floor(m / 60);
  return `hace ${h}h ${m % 60}min`;
}
