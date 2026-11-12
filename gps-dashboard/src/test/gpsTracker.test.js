import { describe, it, expect } from 'vitest';
import { generateEventId } from '../lib/gpsTracker';

describe('generateEventId determinism', () => {
  it('generates the exact same event_id for the same input parameters', () => {
    const deviceId = '123e4567-e89b-12d3-a456-426614174000';
    const timestamp = '2026-10-02T12:00:00.000Z';
    const latitude = -34.6037;
    const longitude = -58.3816;

    const id1 = generateEventId(deviceId, timestamp, latitude, longitude);
    const id2 = generateEventId(deviceId, timestamp, latitude, longitude);

    expect(id1).toBe(id2);
    expect(id1.startsWith('evt-')).toBe(true);
  });

  it('generates different event_id for different inputs', () => {
    const deviceId = '123e4567-e89b-12d3-a456-426614174000';
    const timestamp = '2026-10-02T12:00:00.000Z';
    const latitude1 = -34.6037;
    const longitude = -58.3816;

    const latitude2 = -34.6038;

    const id1 = generateEventId(deviceId, timestamp, latitude1, longitude);
    const id2 = generateEventId(deviceId, timestamp, latitude2, longitude);

    expect(id1).not.toBe(id2);
  });
});
