import { useCallback, useEffect, useRef, useState } from 'react';
import type { Driver, DriverStatus, LiveDriver, LocationPoint } from '../types';
import { isConfigured, supabase } from '../lib/supabase';
import { demoSnapshot, demoTick, demoTrajectory } from '../lib/demo';

export interface LiveDriversState {
  drivers: LiveDriver[];
  loading: boolean;
  isDemo: boolean;
}

export function useLiveDrivers(): LiveDriversState {
  const [drivers, setDrivers] = useState<LiveDriver[]>([]);
  const [loading, setLoading] = useState(true);
  const driversRef = useRef(new Map<string, Driver>());
  const statusRef = useRef(new Map<string, DriverStatus>());

  const rebuild = useCallback(() => {
    const list: LiveDriver[] = [];
    for (const d of driversRef.current.values()) {
      list.push({ ...d, status: statusRef.current.get(d.id) ?? null });
    }
    for (const [id, s] of statusRef.current) {
      if (!driversRef.current.has(id)) {
        list.push({
          id,
          name: `Conductor ${id.slice(0, 4)}`,
          phone: '',
          color: '#94a3b8',
          is_admin: false,
          created_at: '',
          status: s,
        });
      }
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    setDrivers(list);
  }, []);

  useEffect(() => {
    if (!isConfigured || !supabase) {
      setDrivers(demoSnapshot());
      setLoading(false);
      const t = setInterval(() => setDrivers(demoTick()), 2500);
      return () => clearInterval(t);
    }

    const client = supabase;
    let disposed = false;

    const loadInitial = async () => {
      const [dRes, sRes] = await Promise.all([
        client.from('drivers').select('*'),
        client.from('driver_status').select('*'),
      ]);
      if (disposed) return;
      if (dRes.error) console.error('drivers:', dRes.error);
      if (sRes.error) console.error('driver_status:', sRes.error);
      if (dRes.data) for (const d of dRes.data) driversRef.current.set(d.id, d as Driver);
      if (sRes.data) for (const s of sRes.data) statusRef.current.set(s.driver_id, s as DriverStatus);
      rebuild();
      setLoading(false);
    };

    const channel = client
      .channel('live-drivers')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'driver_status' },
        (payload) => {
          const rec = payload.new as DriverStatus | null;
          const old = payload.old as { driver_id: string } | null;
          const id = rec?.driver_id ?? old?.driver_id;
          if (!id) return;
          if (payload.eventType === 'DELETE' || !rec) statusRef.current.delete(id);
          else statusRef.current.set(id, rec);
          rebuild();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'drivers' },
        (payload) => {
          const rec = payload.new as Driver | null;
          const old = payload.old as { id: string } | null;
          const id = rec?.id ?? old?.id;
          if (!id) return;
          if (payload.eventType === 'DELETE' || !rec) driversRef.current.delete(id);
          else driversRef.current.set(id, rec);
          rebuild();
        },
      )
      .subscribe();

    loadInitial();
    return () => {
      disposed = true;
      client.removeChannel(channel);
    };
  }, [rebuild]);

  return { drivers, loading, isDemo: !isConfigured };
}

export async function fetchTrajectory(driverId: string, max = 500): Promise<LocationPoint[]> {
  if (!isConfigured || !supabase) return demoTrajectory(driverId);
  const { data, error } = await supabase
    .from('locations')
    .select('id, driver_id, lat, lng, speed, created_at')
    .eq('driver_id', driverId)
    .order('created_at', { ascending: true })
    .limit(max);
  if (error) {
    console.error(error);
    return [];
  }
  return (data ?? []) as LocationPoint[];
}
