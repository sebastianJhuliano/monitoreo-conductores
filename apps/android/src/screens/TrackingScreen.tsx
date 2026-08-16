import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import * as IntentLauncher from 'expo-intent-launcher';
import { getStats, isTracking, startTracking, stopTracking } from '../location';
import type { StoredDriver } from '../storage';

interface Props {
  driver: StoredDriver;
}

function fmt(n: number | null, digits = 1): string {
  return n === null || n === undefined || Number.isNaN(n) ? '—' : n.toFixed(digits);
}

export default function TrackingScreen({ driver }: Props) {
  const [tracking, setTracking] = useState(false);
  const [checking, setChecking] = useState(true);
  const [stats, setStats] = useState(getStats());
  const [error, setError] = useState<string | null>(null);
  const [perms, setPerms] = useState({ fg: false, bg: false, services: false });

  const refreshPerms = useCallback(async () => {
    try {
      const [fg, bg, services] = await Promise.all([
        Location.getForegroundPermissionsAsync(),
        Location.getBackgroundPermissionsAsync(),
        Location.hasServicesEnabledAsync(),
      ]);
      setPerms({ fg: fg.granted, bg: bg.granted, services });
    } catch {
      // ignorar
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const active = await isTracking();
        if (mounted) setTracking(active);
      } catch {
        // ignorar
      }
      await refreshPerms();
      if (mounted) setChecking(false);
    })();
    const t = setInterval(() => setStats(getStats()), 1000);
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, [refreshPerms]);

  const start = async () => {
    setError(null);
    const fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) {
      setError('Necesitás permitir el acceso a la ubicación para transmitir.');
      await refreshPerms();
      return;
    }
    await Location.requestBackgroundPermissionsAsync();
    await refreshPerms();
    const bg = await Location.getBackgroundPermissionsAsync();
    if (!bg.granted) {
      setError(
        'Activá "Permitir todo el tiempo" en Ajustes para seguir transmitiendo con la pantalla bloqueada.',
      );
      return;
    }
    try {
      await startTracking();
      setTracking(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo iniciar la transmisión');
    }
  };

  const stop = async () => {
    setError(null);
    try {
      await stopTracking();
      setTracking(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo detener la transmisión');
    }
  };

  const openBatterySettings = async () => {
    try {
      await IntentLauncher.startActivityAsync(
        'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
        { data: 'package:com.monitoreo.conductores' },
      );
    } catch {
      Alert.alert(
        'Ajustes de batería',
        'Abrí Ajustes > Batería y desactivá la optimización de batería para esta app.',
      );
    }
  };

  if (checking) {
    return (
      <View style={s.root}>
        <Text style={s.muted}>Cargando…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <Text style={s.title}>Hola, {driver.name}</Text>

      <View style={[s.statusCard, tracking ? s.statusOn : s.statusOff]}>
        <View style={[s.dot, tracking ? s.dotOn : s.dotOff]} />
        <View style={s.statusTextWrap}>
          <Text style={s.statusTitle}>{tracking ? 'Transmitiendo' : 'Transmisión detenida'}</Text>
          <Text style={s.statusSub}>
            {tracking
              ? 'El centro te está viendo en el mapa en tiempo real.'
              : 'Pulsá el botón para empezar a transmitir tu ubicación.'}
          </Text>
        </View>
      </View>

      {error && <Text style={s.error}>{error}</Text>}

      <TouchableOpacity
        style={[s.bigBtn, tracking ? s.bigBtnStop : s.bigBtnStart]}
        onPress={tracking ? stop : start}
      >
        <Text style={s.bigBtnText}>{tracking ? 'Detener transmisión' : 'Empezar a transmitir'}</Text>
      </TouchableOpacity>

      <View style={s.card}>
        <Text style={s.cardTitle}>Permisos</Text>
        <PermRow ok={perms.services} label="Ubicación activada (GPS)" />
        <PermRow ok={perms.fg} label="Permiso de ubicación" />
        <PermRow ok={perms.bg} label={'Permiso "permitir todo el tiempo"'} />
        {!perms.bg && (
          <TouchableOpacity style={s.smallBtn} onPress={() => Linking.openSettings()}>
            <Text style={s.smallBtnText}>Abrir Ajustes y activar</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={s.smallBtn} onPress={openBatterySettings}>
          <Text style={s.smallBtnText}>Optimización de batería</Text>
        </TouchableOpacity>
      </View>

      {tracking && (
        <View style={s.card}>
          <Text style={s.cardTitle}>En vivo</Text>
          <StatRow label="Puntos enviados" value={String(stats.sentCount)} />
          <StatRow label="Precisión" value={`${fmt(stats.lastFix?.accuracy ?? null, 0)} m`} />
          <StatRow label="Velocidad" value={`${fmt(stats.lastFix?.speed ?? null, 0)} m/s`} />
          <StatRow
            label="Actualizado"
            value={stats.lastFix ? new Date(stats.lastFix.at).toLocaleTimeString() : '—'}
          />
          {stats.lastError && <Text style={s.warn}>Último error: {stats.lastError}</Text>}
        </View>
      )}

      <View style={s.card}>
        <Text style={s.cardTitle}>Importante</Text>
        <Text style={s.note}>
          • No cierres la app desde las apps recientes ni la fuerces a detenerse.{'\n'}• En
          Xiaomi/Redmi: activá "Inicio automático" (Ajustes {"›"} Apps {"›"} Monitoreo Conductores {"›"} Otros
          permisos) para que no la maten.{'\n'}• La notificación permanente "Monitoreo activo"
          significa que seguís transmitiendo.{'\n'}• La batería dura más si conectás el celular
          durante la jornada.
        </Text>
      </View>
    </ScrollView>
  );
}

function PermRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <View style={s.permRow}>
      <View style={[s.permDot, ok ? s.permDotOk : s.permDotBad]} />
      <Text style={[s.permLabel, ok ? s.permLabelOk : s.permLabelBad]}>{label}</Text>
    </View>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.statRow}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={s.statValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  muted: {
    color: '#64748b',
    textAlign: 'center',
    marginTop: 80,
  },
  title: {
    color: '#e2e8f0',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 16,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  statusOn: {
    backgroundColor: '#052e16',
    borderColor: '#16a34a',
  },
  statusOff: {
    backgroundColor: '#1e293b',
    borderColor: '#334155',
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  dotOn: {
    backgroundColor: '#22c55e',
  },
  dotOff: {
    backgroundColor: '#64748b',
  },
  statusTextWrap: {
    flex: 1,
  },
  statusTitle: {
    color: '#e2e8f0',
    fontSize: 16,
    fontWeight: '700',
  },
  statusSub: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 2,
  },
  error: {
    color: '#fca5a5',
    backgroundColor: '#450a0a',
    borderColor: '#7f1d1d',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginTop: 14,
    fontSize: 13,
    lineHeight: 18,
  },
  bigBtn: {
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  bigBtnStart: {
    backgroundColor: '#2563eb',
  },
  bigBtnStop: {
    backgroundColor: '#dc2626',
  },
  bigBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  card: {
    backgroundColor: '#1e293b',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginTop: 16,
  },
  cardTitle: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 12,
  },
  permRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  permDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  permDotOk: {
    backgroundColor: '#22c55e',
  },
  permDotBad: {
    backgroundColor: '#ef4444',
  },
  permLabel: {
    fontSize: 13,
  },
  permLabelOk: {
    color: '#bbf7d0',
  },
  permLabelBad: {
    color: '#fecaca',
  },
  smallBtn: {
    borderColor: '#475569',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  smallBtnText: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '600',
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
  },
  statLabel: {
    color: '#94a3b8',
    fontSize: 13,
  },
  statValue: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '600',
  },
  warn: {
    color: '#fbbf24',
    fontSize: 12,
    marginTop: 8,
  },
  note: {
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 20,
  },
});
