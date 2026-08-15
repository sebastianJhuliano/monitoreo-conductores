import { useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../lib/supabase';

interface LoginProps {
  onAuthed: () => void;
}

export default function Login({ onAuthed }: LoginProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!supabase) return null;
  const sb = supabase;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'register') {
        if (!name.trim()) throw new Error('Ingresá tu nombre');
        const { data: su, error: se } = await sb.auth.signUp({ email, password });
        if (se) throw se;
        let user = su.user;
        if (!user) {
          const { data: li, error: le } = await sb.auth.signInWithPassword({ email, password });
          if (le) throw le;
          user = li.user;
        }
        if (!user) throw new Error('No se pudo crear la cuenta');
        const { error: de } = await sb
          .from('drivers')
          .insert({ auth_user_id: user.id, name: name.trim(), phone: '' });
        if (de) throw de;
      } else {
        const { error: le } = await sb.auth.signInWithPassword({ email, password });
        if (le) throw le;
      }
      onAuthed();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mc-auth">
      <form className="mc-auth-card" onSubmit={submit}>
        <div className="mc-brand mc-brand-center">
          <span className="mc-brand-dot" />
          <h1>Centro de Monitoreo</h1>
        </div>
        <p className="mc-auth-sub">
          {mode === 'login'
            ? 'Ingresá con tu cuenta de administrador.'
            : 'Registrate. La primera cuenta creada se convierte en administrador.'}
        </p>

        {mode === 'register' && (
          <label className="mc-field">
            <span>Nombre</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tu nombre"
            />
          </label>
        )}

        <label className="mc-field">
          <span>Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@ejemplo.com"
          />
        </label>

        <label className="mc-field">
          <span>Contraseña</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </label>

        {error && <p className="mc-error">{error}</p>}

        <button className="mc-btn mc-btn-primary mc-btn-block" disabled={busy}>
          {busy ? 'Procesando…' : mode === 'login' ? 'Ingresar' : 'Crear cuenta'}
        </button>

        <button type="button" className="mc-auth-toggle" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? '¿Primera vez? Crear cuenta de administrador' : 'Ya tengo cuenta, ingresar'}
        </button>
      </form>
    </div>
  );
}
