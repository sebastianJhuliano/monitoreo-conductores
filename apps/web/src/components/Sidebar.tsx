import { useMemo, useState } from 'react';
import type { LiveDriver } from '../types';
import { timeAgo } from '../lib/wa';

interface SidebarProps {
  drivers: LiveDriver[];
  loading: boolean;
  isDemo: boolean;
  selectedId: string | null;
  now: number;
  onSelect: (id: string) => void;
  onDelete?: (id: string, name: string) => void;
  onSignOut?: () => void;
}

function driverState(d: LiveDriver, now: number): { label: string; cls: string } {
  if (!d.status) return { label: 'Sin datos', cls: 'st-none' };
  if (now - new Date(d.status.updated_at).getTime() > 120_000) {
    return { label: 'Offline', cls: 'st-offline' };
  }
  if (d.status.has_fix === false) {
    return { label: 'Sin señal GPS', cls: 'st-gps' };
  }
  return d.status.is_moving
    ? { label: 'En movimiento', cls: 'st-moving' }
    : { label: 'Detenido', cls: 'st-stopped' };
}

export default function Sidebar({
  drivers,
  loading,
  isDemo,
  selectedId,
  now,
  onSelect,
  onDelete,
  onSignOut,
}: SidebarProps) {
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);

  const inviteUrl = import.meta.env.VITE_INVITE_URL || window.location.origin;

  const copyInvite = () => {
    navigator.clipboard?.writeText(inviteUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return drivers.filter(
      (d) => !d.is_admin && (!q || d.name.toLowerCase().includes(q) || d.phone.includes(q)),
    );
  }, [drivers, query]);

  const online = drivers.filter(
    (d) => d.status && now - new Date(d.status.updated_at).getTime() <= 120_000,
  ).length;

  return (
    <aside className="mc-sidebar">
      <div className="mc-brand">
        <span className="mc-brand-dot" />
        <h1>Centro de Monitoreo</h1>
      </div>

      <div className="mc-invite">
        <button className="mc-btn mc-btn-primary" onClick={copyInvite} disabled={isDemo}>
          {copied ? '¡Link copiado!' : 'Copiar link para conductores'}
        </button>
        {isDemo && (
          <p className="mc-hint">
            Modo demo: no hay Supabase configurado. El link se habilita al conectar el backend.
          </p>
        )}
      </div>

      <div className="mc-stats">
        <div>
          <strong>{online}</strong>
          <span>online</span>
        </div>
        <div>
          <strong>{visible.length}</strong>
          <span>conductores</span>
        </div>
      </div>

      <input
        className="mc-search"
        type="search"
        placeholder="Buscar conductor…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="mc-list">
        {loading && <p className="mc-empty">Cargando conductores…</p>}
        {!loading && visible.length === 0 && (
          <p className="mc-empty">Aún no hay conductores registrados.</p>
        )}
        {visible.map((d) => {
          const st = driverState(d, now);
          return (
            <button
              key={d.id}
              className={`mc-item${d.id === selectedId ? ' mc-item-selected' : ''}`}
              onClick={() => onSelect(d.id)}
            >
              <span className="mc-item-dot" style={{ background: d.color }} />
              <span className="mc-item-info">
                <span className="mc-item-name">{d.name}</span>
                <span className="mc-item-meta">
                  {d.phone || 'Sin teléfono'} · {timeAgo(d.status?.updated_at ?? null)}
                </span>
              </span>
              <span className={`mc-badge ${st.cls}`}>{st.label}</span>
              {onDelete && !isDemo && (
                <button
                  className="mc-del"
                  title="Eliminar conductor"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(d.id, d.name);
                  }}
                >
                  ✕
                </button>
              )}
            </button>
          );
        })}
      </div>

      {onSignOut && (
        <button className="mc-signout" onClick={onSignOut}>
          Cerrar sesión
        </button>
      )}
    </aside>
  );
}
