import { Component, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import RegisterScreen from './src/screens/RegisterScreen';
import TrackingScreen from './src/screens/TrackingScreen';
import { getStoredDriver, getTrackingActive, type StoredDriver } from './src/storage';
import { ensureDriverSession } from './src/register';
import { isConfigured } from './src/config';
import { reportError, flushErrorLog } from './src/errors';
import { LOCATION_TASK, startTracking } from './src/location';

type State = 'loading' | 'config' | 'register' | 'tracking';

// Captura global de errores JS: los mandamos a Supabase para diagnosticar.
const g = globalThis as unknown as {
  ErrorUtils?: {
    getGlobalHandler?: () => (e: unknown, f: boolean) => void;
    setGlobalHandler?: (h: (e: unknown, f: boolean) => void) => void;
  };
};
if (g.ErrorUtils) {
  const gh = g.ErrorUtils.getGlobalHandler?.();
  g.ErrorUtils.setGlobalHandler?.((error: unknown, isFatal: boolean) => {
    reportError('global', error);
    if (gh) gh(error, isFatal);
  });
}

class Boundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  componentDidCatch(err: Error) {
    reportError('boundary', err);
  }
  render() {
    if (this.state.err) {
      return (
        <View style={s.center}>
          <Text style={s.error}>
            Ocurrió un error inesperado. Volvé a abrir la app y tocá "Empezar a transmitir".
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [state, setState] = useState<State>('loading');
  const [driver, setDriver] = useState<StoredDriver | null>(null);

  useEffect(() => {
    (async () => {
      // Si el celular se apagó y se prendió de nuevo mientras transmitíamos,
      // reanudar la transmisión automáticamente (la abre el BootResumeReceiver).
      const wasTracking = await getTrackingActive();
      if (wasTracking) {
        try {
          await startTracking();
        } catch (e) {
          reportError('startup:resume', e);
        }
      } else {
        // Limpiar tareas de fondo que hayan quedado de un cierre anterior,
        // para evitar que el sistema intente ejecutarlas y crashee la app.
        await TaskManager.unregisterAllTasksAsync();
        await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => {});
      }
      // Enviar errores que quedaron guardados de un cierre anterior.
      flushErrorLog();
      if (!isConfigured) {
        setState('config');
        return;
      }
      try {
        const stored = await getStoredDriver();
        if (!stored) {
          setState('register');
          return;
        }
        const restored = await ensureDriverSession(stored);
        if (!restored) {
          setState('register');
          return;
        }
        setDriver(restored);
        setState('tracking');
      } catch (e) {
        reportError('startup:load', e);
        setState('register');
      }
    })();
  }, []);

  return (
    <Boundary>
      <SafeAreaView style={s.root}>
        <StatusBar style="light" />
        {state === 'loading' && (
          <View style={s.center}>
            <Text style={s.muted}>Cargando…</Text>
          </View>
        )}
        {state === 'config' && (
          <View style={s.center}>
            <Text style={s.error}>
              La app no está configurada. Definí EXPO_PUBLIC_SUPABASE_URL y
              EXPO_PUBLIC_SUPABASE_ANON_KEY y volvé a compilar.
            </Text>
          </View>
        )}
        {state === 'register' && (
          <RegisterScreen
            onDone={(d) => {
              setDriver(d);
              setState('tracking');
            }}
          />
        )}
        {state === 'tracking' && driver && (
          <TrackingScreen
            driver={driver}
            onReset={() => {
              setDriver(null);
              setState('register');
            }}
          />
        )}
      </SafeAreaView>
    </Boundary>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  muted: {
    color: '#64748b',
  },
  error: {
    color: '#fca5a5',
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
  },
});
