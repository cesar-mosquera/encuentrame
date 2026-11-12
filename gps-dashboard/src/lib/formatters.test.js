// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatTimestamp } from './formatters';

describe('formatTimestamp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-27T15:30:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('devuelve "--" para valores vacíos', () => {
    expect(formatTimestamp(null)).toBe('--');
    expect(formatTimestamp(undefined)).toBe('--');
    expect(formatTimestamp('')).toBe('--');
  });

  it('respeta las etiquetas ya formateadas', () => {
    expect(formatTimestamp('En línea')).toBe('En línea');
    expect(formatTimestamp('Ahora')).toBe('Ahora');
  });

  it('devuelve el valor original si la fecha es inválida', () => {
    expect(formatTimestamp('no-es-una-fecha')).toBe('no-es-una-fecha');
  });

  it('prefija "Hoy" para timestamps del mismo día', () => {
    const result = formatTimestamp(new Date('2026-10-27T08:15:00').toISOString());
    expect(result).toMatch(/^Hoy \d{2}:\d{2}/);
  });

  it('incluye día/mes para fechas anteriores', () => {
    const result = formatTimestamp(new Date('2026-10-25T08:15:00').toISOString());
    expect(result).not.toMatch(/^Hoy/);
    expect(result).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}/);
  });

  it('acepta Date, número y string ISO sin lanzar', () => {
    const date = new Date('2026-10-27T08:15:00');
    expect(formatTimestamp(date)).toMatch(/^Hoy/);
    expect(formatTimestamp(date.getTime())).toMatch(/^Hoy/);
    expect(formatTimestamp(date.toISOString())).toMatch(/^Hoy/);
  });
});
