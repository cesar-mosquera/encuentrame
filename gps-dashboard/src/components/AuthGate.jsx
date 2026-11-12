import React, { useEffect, useRef, useState } from 'react';
import { LogIn, LogOut, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

export const AuthGate = ({ children }) => {
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  const [hasProfile, setHasProfile] = useState(true);
  const [profileError, setProfileError] = useState('');
  const [isCheckingProfile, setIsCheckingProfile] = useState(false);
  const verifyingRef = useRef(false);

  const [initError, setInitError] = useState('');
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const verifyProfile = async (currentSession) => {
    if (!currentSession || currentSession.isDevelopment || !supabase) {
      if (mountedRef.current) {
        setHasProfile(true);
        setProfileError('');
      }
      return;
    }

    const targetUserId = currentSession.user?.id;
    if (!targetUserId) return;

    if (verifyingRef.current) return;
    verifyingRef.current = true;
    if (mountedRef.current) setIsCheckingProfile(true);

    try {
      const { data, error: profileErr } = await supabase
        .from('profiles')
        .select('user_id, organization_id, role')
        .eq('user_id', targetUserId)
        .maybeSingle();

      if (!mountedRef.current) return;

      const activeUser = (await supabase.auth.getSession()).data.session?.user?.id;
      if (activeUser !== targetUserId) return;

      if (profileErr) {
        setHasProfile(false);
        setProfileError(`Error de consulta (${profileErr.message || 'Sin conexión'})`);
      } else if (!data) {
        setHasProfile(false);
        setProfileError('Tu usuario no tiene un perfil de operador asignado.');
      } else {
        setHasProfile(true);
        setProfileError('');
      }
    } catch (err) {
      if (mountedRef.current) {
        setHasProfile(false);
        setProfileError(err?.message || 'Error de conexión al verificar el perfil');
      }
    } finally {
      if (mountedRef.current) {
        setIsCheckingProfile(false);
      }
      verifyingRef.current = false;
    }
  };

  useEffect(() => {
    if (!supabase) return undefined;
    supabase.auth.getSession()
      .then(({ data }) => {
        setSession(data.session);
        if (data.session) verifyProfile(data.session);
      })
      .catch((err) => {
        setInitError(err?.message || 'Error de conexión al iniciar sesión');
      });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession) verifyProfile(nextSession);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (!supabase) {
    return <AuthMessage message="Configura Supabase para habilitar el acceso al panel." />;
  }

  if (initError) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="auth-mark" style={{ background: '#ef4444' }}><AlertCircle size={20} /></div>
          <span className="auth-eyebrow">RideGuard · Error de Conexión</span>
          <h1>Fallo al cargar sesión</h1>
          <p>{initError}</p>
          <button type="button" onClick={() => window.location.reload()} className="auth-switch" style={{ marginTop: '1rem' }}>
            Reintentar
          </button>
        </section>
      </main>
    );
  }

  const handleSignOut = async () => {
    localStorage.removeItem('gps_dev_admin');
    if (supabase) await supabase.auth.signOut();
    setSession(null);
    setHasProfile(true);
    setProfileError('');
  };

  if (session) {
    if (isCheckingProfile) {
      return (
        <main className="auth-shell">
          <section className="auth-card">
            <h1>Verificando perfil de operador...</h1>
            <p>Por favor espera mientras validamos tus permisos de acceso.</p>
          </section>
        </main>
      );
    }

    if (!hasProfile) {
      return (
        <main className="auth-shell">
          <section className="auth-card">
            <div className="auth-mark" style={{ background: '#ef4444' }}><AlertCircle size={20} /></div>
            <span className="auth-eyebrow">RideGuard · Error de perfil</span>
            <h1>Sin perfil de operador</h1>
            <p>{profileError || 'Tu cuenta de usuario se autenticó correctamente pero no tiene un perfil asignado ni pertenece a una organización activa.'}</p>
            <button type="button" onClick={handleSignOut} className="auth-switch" style={{ marginTop: '1rem' }}>
              <LogOut size={15} /> Cerrar sesión y reintentar
            </button>
          </section>
        </main>
      );
    }

    return children;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setIsBusy(true);

    try {


      const result = await supabase.auth.signInWithPassword({ email, password });

      if (result.error) {
        setError(result.error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos' : result.error.message);
      }
    } catch (err) {
      setError(err.message || 'Error de conexión a internet o de red');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-mark"><LogIn size={20} /></div>
        <span className="auth-eyebrow">RideGuard · Panel privado</span>
        <h1>Entrar al monitoreo</h1>
        <p>Acceso restringido solo a personal autorizado.</p>
        <form onSubmit={handleSubmit} className="auth-form">
          <label>Correo<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></label>
          <label>Contraseña<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} autoComplete="current-password" /></label>
          {error && <div className="auth-error">{error}</div>}
          <button type="submit" disabled={isBusy}>{isBusy ? 'Verificando...' : 'Entrar'}</button>
        </form>
      </section>
    </main>
  );
};

const AuthMessage = ({ message }) => (
  <main className="auth-shell"><section className="auth-card"><span className="auth-eyebrow">RideGuard</span><h1>Panel no configurado</h1><p>{message}</p></section></main>
);
