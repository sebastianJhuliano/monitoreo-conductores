import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { signInDriver } from '../register';
import type { StoredDriver } from '../storage';

export default function RegisterScreen({ onDone }: { onDone: (d: StoredDriver) => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return Alert.alert('Falta el nombre', 'Ingresá tu nombre.');
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
      <View style={s.card}>
        <Text style={s.title}>Bienvenido</Text>
        <Text style={s.subtitle}>
          Registrate para que el centro de monitoreo vea tu ubicación en tiempo real durante la
          jornada.
        </Text>

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
          onChangeText={setPhone}
          placeholder="Ej: 541123456789"
          placeholderTextColor="#64748b"
          keyboardType="phone-pad"
        />
        <Text style={s.hint}>Incluí el código de país: 54 + 11 2345 6789 → 541123456789</Text>

        <TouchableOpacity style={[s.btn, busy && s.btnDisabled]} onPress={submit} disabled={busy}>
          <Text style={s.btnText}>{busy ? 'Registrando…' : 'Registrarme y continuar'}</Text>
        </TouchableOpacity>

        <Text style={s.note}>
          Tu ubicación se usa únicamente para el monitoreo durante la jornada.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    padding: 24,
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
    marginBottom: 18,
  },
  label: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 6,
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
  hint: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 6,
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
