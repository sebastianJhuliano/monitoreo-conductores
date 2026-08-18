import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as IntentLauncher from 'expo-intent-launcher';
import { signInDriver } from '../register';
import { formatPhoneInput, toInternational } from '../phone';
import type { StoredDriver } from '../storage';

interface Perms {
  fg: boolean;
  bg: boolean;
  services: boolean;
  notif: boolean;
}

export default function RegisterScreen({ onDone }: { onDone: (d: StoredDriver) => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [perms, setPerms] = useState<Perms>({ fg: false, bg: false, services: false, notif: false });
  const [asking, setAsking] = useState(false);

  const refreshPerms = useCallback(async () => {
    try {
      const [fg, bg, services, notif] = await Promise.all([
        Location.getForegroundPermissionsAsync(),
        Location.getBackgroundPermissionsAsync(),
        Location.hasServicesEnabledAsync(),
        Notifications.getPermissionsAsync(),
      ]);
      setPerms({
        fg: fg.granted,
        bg: bg.granted,
        services,
        notif: notif.granted || notif.status === 'granted',
      });
    } catch {
      // ignorar
    }
  }, []);

  const askLocation = useCallback(async () => {
    setAsking(true);
    try {
      const fg = await Location.requestForegroundPermissionsAsync();
      if (fg.granted) {
        await Location.requestBackgroundPermissionsAsync();
      }
    } catch {
      // ignorar
    }
    setAsking(false);
    await refreshPerms();
  }, [refreshPerms]);

  const askNotifications = useCallback(async () => {
    try {
      await Notifications.requestPermissionsAsync();
    } catch {
      // ignorar
    }
    await refreshPerms();
  }, [refreshPerms]);

  // Pedir los permisos apenas se abre la app por primera vez.
  useEffect(() => {
    const t = setTimeout(() => {
      askLocation();
      askNotifications();
    }, 400);
    refreshPerms();
    return () => clearTimeout(t);
  }, [askLocation, askNotifications, refreshPerms]);

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

  const submit = async () => {
    if (!name.trim()) return Alert.alert('Falta el nombre', 'Ingresá tu nombre.');
    if (!toInternational(phone)) {
      return Alert.alert(
        'Número no válido',
        'Escribí tu celular como lo usás en WhatsApp, por ejemplo: 0982 362 830',
      );
    }
    if (busy) return;
    setBusy(true);
    try {
      const driver = await signInDriver(name, phone);
      onDone(driver);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.card}>
          <Text style={s.title}>Bienvenido</Text>
          <Text style={s.subtitle}>
            Registrate para que el centro de monitoreo vea tu ubicación en tiempo real durante la
            jornada.
          </Text>

          <Text style={s.label}>Permisos necesarios</Text>
          <Text style={s.hint}>
            Sin estos permisos la app no puede transmitir con la pantalla bloqueada. Se piden acá
            mismo, no hace falta buscar nada en Ajustes.
          </Text>

          <PermRow ok={perms.fg} label="Ubicación (precisa)" />
          <PermRow ok={perms.bg} label={'Ubicación "permitir todo el tiempo"'} />
          <PermRow ok={perms.notif} label="Notificaciones (aviso de transmisión)" />
          <PermRow ok={perms.services} label="GPS activado" />

          {!perms.fg || !perms.bg ? (
            <TouchableOpacity style={s.smallBtn} onPress={askLocation} disabled={asking}>
              <Text style={s.smallBtnText}>
                {asking ? 'Pidiendo permisos…' : 'Permitir ubicación (todo el tiempo)'}
              </Text>
            </TouchableOpacity>
          ) : null}

          {!perms.bg && (
            <TouchableOpacity style={s.smallBtn} onPress={() => Linking.openSettings()}>
              <Text style={s.smallBtnText}>Abrir Ajustes y activar "todo el tiempo"</Text>
            </TouchableOpacity>
          )}

          {!perms.notif && (
            <TouchableOpacity style={s.smallBtn} onPress={askNotifications}>
              <Text style={s.smallBtnText}>Permitir notificaciones</Text>
            </TouchableOpacity>
          )}

          {!perms.services && (
            <TouchableOpacity style={s.smallBtn} onPress={() => Linking.openSettings()}>
              <Text style={s.smallBtnText}>Activar GPS</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={s.smallBtn} onPress={openBatterySettings}>
            <Text style={s.smallBtnText}>
              Permitir uso en segundo plano (batería) — importante
            </Text>
          </TouchableOpacity>

          <Text style={s.label}>Nombre</Text>
          <TextInput
            style={s.input}
            value={name}
            onChangeText={setName}
            placeholder="Ej: Carlos Pérez"
            placeholderTextColor="#64748b"
            autoCapitalize="words"
          />

          <Text style={s.label}>Número de WhatsApp</Text>
          <TextInput
            style={s.input}
            value={phone}
            onChangeText={(t) => setPhone(formatPhoneInput(t))}
            placeholder="Ej: 0982 362 830"
            placeholderTextColor="#64748b"
            keyboardType="phone-pad"
            maxLength={14}
          />
          <Text style={s.hint}>
            Escribí tu número tal cual lo usás en WhatsApp, sin el código de país.
          </Text>

          <TouchableOpacity style={[s.btn, busy && s.btnDisabled]} onPress={submit} disabled={busy}>
            <Text style={s.btnText}>{busy ? 'Registrando…' : 'Registrarme y continuar'}</Text>
          </TouchableOpacity>

          <Text style={s.note}>
            Tu ubicación se usa únicamente para el monitoreo durante la jornada.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
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

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  content: {
    padding: 24,
    paddingTop: 48,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 24,
  },
  title: {
    color: '#e2e8f0',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 6,
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 14,
  },
  label: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 14,
    marginBottom: 6,
  },
  hint: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 8,
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
    padding: 11,
    alignItems: 'center',
    marginTop: 8,
  },
  smallBtnText: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#273449',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    color: '#e2e8f0',
    fontSize: 15,
  },
  btn: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  btnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  note: {
    color: '#64748b',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 16,
  },
});