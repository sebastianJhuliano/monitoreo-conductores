import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, isConfigured } from './lib/supabase';
import Login from './components/Login';
import Dashboard from './components/Dashboard';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!isConfigured || !supabase) {
      setChecking(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setChecking(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (checking) return <div className="mc-loading">Cargando…</div>;

  if (!isConfigured || !supabase) return <Dashboard />;
  const sb = supabase;

  if (!session) {
    return (
      <Login
        onAuthed={() => void sb.auth.getSession().then(({ data }) => setSession(data.session))}
      />
    );
  }
  return <Dashboard onSignOut={() => void sb.auth.signOut()} />;
}
