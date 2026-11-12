// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { AuthGate } from '../components/AuthGate';

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
        limit: vi.fn().mockResolvedValue({ data: [{ id: 'org-1' }] }),
      }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 'org-1' } }),
        }),
      }),
    }),
  },
}));

describe('AuthGate', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('renderiza el formulario de inicio de sesión cuando no hay sesión activa', async () => {
    render(
      <AuthGate>
        <div>Panel Protegido</div>
      </AuthGate>
    );
    expect(await screen.findByText('Entrar al monitoreo')).toBeInTheDocument();
  });

  it('muestra error de perfil si el usuario no tiene perfil asignado', async () => {
    const { supabase } = await import('../lib/supabase');
    supabase.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'u-1' } } }
    });
    // mock maybeSingle to return no data (no profile)
    supabase.from().select().eq().maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    render(
      <AuthGate>
        <div>Panel Protegido</div>
      </AuthGate>
    );

    expect(await screen.findByText('Sin perfil de operador')).toBeInTheDocument();
    expect(await screen.findByText(/no tiene un perfil de operador asignado/)).toBeInTheDocument();
  });

  it('renderiza los hijos (hace bypass) si el perfil es de un operador autorizado', async () => {
    const { supabase } = await import('../lib/supabase');
    supabase.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'u-1' } } }
    });
    // mock maybeSingle to return a valid profile
    supabase.from().select().eq().maybeSingle.mockResolvedValueOnce({ 
      data: { user_id: 'u-1', role: 'operator', organization_id: 'org-1' }, 
      error: null 
    });

    render(
      <AuthGate>
        <div>Panel Protegido</div>
      </AuthGate>
    );

    expect(await screen.findByText('Panel Protegido')).toBeInTheDocument();
  });

  it('muestra error de conexión si el query del perfil falla', async () => {
    const { supabase } = await import('../lib/supabase');
    supabase.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'u-1' } } }
    });
    // mock maybeSingle to return error
    supabase.from().select().eq().maybeSingle.mockResolvedValueOnce({ 
      data: null, 
      error: { message: 'Database unreachable' } 
    });

    render(
      <AuthGate>
        <div>Panel Protegido</div>
      </AuthGate>
    );

    expect(await screen.findByText('Sin perfil de operador')).toBeInTheDocument();
    expect(await screen.findByText(/Error de consulta/)).toBeInTheDocument();
  });
});
