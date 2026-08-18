// Manejo de números de teléfono paraguayos.
// El conductor escribe su número como lo usa: 0982 362 830
// La app lo convierte a formato internacional (595982362830)
// para que el WhatsApp del panel funcione.

const PY_COUNTRY = '595';

// Máscara en vivo mientras escribe: "0982 362 830" o "595 982 362 830"
export function formatPhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) {
    // Formato nacional: 0982 362 830 (10 dígitos, grupos 4-3-3)
    const d = digits.slice(0, 10);
    const a = d.slice(0, 4);
    const b = d.slice(4, 7);
    const c = d.slice(7, 10);
    return [a, b, c].filter(Boolean).join(' ');
  }
  // Internacional o sin el 0: 595 982 362 830 (grupos 3-3-3-3)
  const d = digits.slice(0, 12);
  const parts: string[] = [];
  for (let i = 0; i < d.length; i += 3) parts.push(d.slice(i, i + 3));
  return parts.join(' ');
}

// Convierte lo que escribió el conductor a formato internacional.
// Devuelve null si no es un número paraguayo válido.
export function toInternational(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith(PY_COUNTRY) && digits.length === 12) {
    return digits; // ya venía como 595982362830 o +595982362830
  }
  if (digits.startsWith('0') && digits.length === 10) {
    return PY_COUNTRY + digits.slice(1); // 0982 362 830 → 595982362830
  }
  if (digits.length === 9) {
    return PY_COUNTRY + digits; // 982 362 830 → 595982362830
  }
  return null;
}