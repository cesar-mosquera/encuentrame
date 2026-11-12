// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FleetPanel from '../components/command/FleetPanel';

describe('FleetPanel con dispositivos offline sin ubicación', () => {
  it('muestra dispositivos offline sin posición y permite seleccionarlos', async () => {
    const user = userEvent.setup();
    const handleSelect = vi.fn();

    const mockDevices = [
      {
        id: 'DEV-ONLINE-01',
        name: 'Dispositivo Online',
        status: 'active',
        position: [4.6097, -74.0817],
        battery: 85,
        lastUpdate: 'En línea',
      },
      {
        id: 'DEV-OFFLINE-02',
        name: 'Dispositivo Offline Sin GPS',
        status: 'offline',
        position: null,
        battery: 12,
        lastUpdate: 'Hace 3 días',
      },
    ];

    render(
      <FleetPanel
        entities={mockDevices}
        onSelectEntity={handleSelect}
      />
    );

    // Ambos dispositivos deben mostrarse en el panel
    expect(screen.getByText('Dispositivo Online')).toBeInTheDocument();
    expect(screen.getByText('Dispositivo Offline Sin GPS')).toBeInTheDocument();

    // Al hacer clic en el dispositivo offline sin posición
    const offlineItem = screen.getByText('Dispositivo Offline Sin GPS');
    await user.click(offlineItem);

    expect(handleSelect).toHaveBeenCalledWith(mockDevices[1]);
  });
});