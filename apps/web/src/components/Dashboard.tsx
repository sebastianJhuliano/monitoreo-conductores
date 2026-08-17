import { useCallback, useEffect, useState } from 'react';
import type { LocationPoint } from '../types';
import { useLiveDrivers, fetchTrajectory } from '../hooks/useLiveDrivers';
import { supabase, isConfigured } from '../lib/supabase';
import MapView from './MapView';
import Sidebar from './Sidebar';

interface DashboardProps {
  onSignOut?: () => void;
}

export default function Dashboard({ onSignOut }: DashboardProps) {
  const { drivers, loading, isDemo } = useLiveDrivers();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [trajectory, setTrajectory] = useState<LocationPoint[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    setTrajectory([]);
    fetchTrajectory(id).then(setTrajectory);
  }, []);

  const removeDriver = useCallback(async (id: string, name: string) => {
    if (!isConfigured || !supabase) return;
    if (!window.confirm(`¿Eliminar a ${name}? Se borra su historial y ya no podrá transmitir.`)) {
      return;
    }
    const { error } = await supabase.rpc('delete_driver', { p_id: id });
    if (error) {
      window.alert('No se pudo eliminar: ' + error.message);
    }
  }, []);

  const clearTrajectory = useCallback(async (id: string, name: string) => {
    if (!isConfigured || !supabase) return;
    if (!window.confirm(`¿Borrar la trayectoria de ${name}? Los puntos nuevos seguirán apareciendo.`)) {
      return;
    }
    const { error } = await supabase.rpc('clear_trajectory', { p_driver_id: id });
    if (error) {
      window.alert('No se pudo limpiar: ' + error.message);
      return;
    }
    if (selectedId === id) setTrajectory([]);
  }, [selectedId]);

  return (
    <div className="mc-layout">
      <Sidebar
        drivers={drivers}
        loading={loading}
        isDemo={isDemo}
        selectedId={selectedId}
        now={now}
        onSelect={select}
        onDelete={removeDriver}
        onSignOut={onSignOut}
      />
      <main className="mc-main">
        <MapView
          drivers={drivers}
          selectedId={selectedId}
          onSelect={select}
          trajectory={trajectory}
          now={now}
          onClearTrajectory={clearTrajectory}
        />
      </main>
    </div>
  );
}
