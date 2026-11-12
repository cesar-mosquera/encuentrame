// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createGeofence, transformGeofence } from '../lib/queries';

vi.mock('../lib/supabase', () => ({
  withAuthRetry: (fn) => fn(),
  supabase: {
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 99,
              name: 'Geocerca Test',
              type: 'circle',
              center: [4.6, -74.08],
              radius: 500,
              color: '#00E676',
              rule: 'outside',
              active: true,
            },
            error: null,
          }),
        }),
      }),
    }),
  },
}));


describe('Geofence creation and persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normaliza la regla de geocerca a outside o inside según la restricción SQL', () => {
    const geo1 = transformGeofence({ id: 1, rule: 'Supervisión de ubicación' });
    expect(geo1.rule).toBe('outside');

    const geo2 = transformGeofence({ id: 2, rule: 'inside' });
    expect(geo2.rule).toBe('inside');
  });

  it('crea e inserta una nueva geocerca en Supabase con formato seguro', async () => {
    const newGeofence = {
      name: 'Nueva geocerca',
      type: 'circle',
      center: [4.6, -74.08],
      radius: 500,
      rule: 'outside',
    };

    const result = await createGeofence(newGeofence);
    expect(result).toBeDefined();
    expect(result.id).toBe(99);
    expect(result.rule).toBe('outside');
  });
});
