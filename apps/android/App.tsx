import { useEffect, useState } from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import RegisterScreen from './src/screens/RegisterScreen';
import TrackingScreen from './src/screens/TrackingScreen';
import { getStoredDriver, type StoredDriver } from './src/storage';
import { ensureDriverSession } from './src/register';
import { isConfigured } from './src/config';

type State = 'loading' | 'config' | 'register' | 'tracking';

export default function App() {
  const [state, setState] = useState<State>('loading');
  const [driver, setDriver] = useState<StoredDriver | null>(null);

  useEffect(() => {
    (async () => {
      if (!isConfigured) {
        setState('config');
        return;
      }
      const stored = await getStoredDriver();
      if (!stored) {
        setState('register');
        return;
      }
      await ensureDriverSession(stored);
      setDriver(stored);
      setState('tracking');
    })();
  }, []);

  return (
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
      {state === 'tracking' && driver && <TrackingScreen driver={driver} />}
    </SafeAreaView>
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
