import { useCallback, useEffect, useState } from 'react';
import type { LocationPoint } from '../types';
import { useLiveDrivers, fetchTrajectory } from '../hooks/useLiveDrivers';
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

  return (
    <div className="mc-layout">
      <Sidebar
        drivers={drivers}
        loading={loading}
        isDemo={isDemo}
        selectedId={selectedId}
        now={now}
        onSelect={select}
        onSignOut={onSignOut}
      />
      <main className="mc-main">
        <MapView
          drivers={drivers}
          selectedId={selectedId}
          onSelect={select}
          trajectory={trajectory}
          now={now}
        />
      </main>
    </div>
  );
}
