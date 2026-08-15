export function waLink(phone: string, text?: string): string {
  const digits = phone.replace(/\D/g, '');
  const base = `https://wa.me/${digits}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
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
