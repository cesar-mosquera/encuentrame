// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CommandCenter from '../components/command/CommandCenter';

global.ResizeObserver = global.ResizeObserver || class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

import { DashboardContext } from '../context/dashboard-context';

describe('smoke: CommandCenter render', () => {
  it('renderiza sin errores con 1 dispositivo y 1 vehículo (sin posición)', () => {
    const devices = [{
      id: 'DEV-1', name: 'Tracker A', status: 'active', position: [4.6097, -74.0817],
      battery: 80, speed: 12, accuracy: 9, lastUpdate: 'Ahora',
    }];
    const vehicles = [{
      id: 'MOTO-1', name: 'Moto Demo', status: 'offline', position: null,
      battery: 40, speed: 0, accuracy: null, lastUpdate: 'Hace 2 días',
    }];

    const mockState = {
      category: 'all',
      selectedEntity: null,
      isFollowingRoute: false,
      userLocation: null,
      origin: null,
      locateUserTrigger: 0,
      flyToTrigger: null,
      focusTrigger: null,
      isControlBusy: false,
      lastSyncLabel: 'Act. 10:30',
      fleetLoading: false
    };

    const mockData = {
      devices,
      vehicles,
      alerts: [],
      geofences: [],
      devicesList: devices,
      vehiclesList: vehicles,
      activeNetworkError: null,
      fleetLoading: false,
      vehiclesStale: false,
      devicesStale: false,
      vehiclesSyncTime: null,
      devicesSyncTime: null,
      hideEphemeral: () => {},
      refetchVehicles: () => {},
      refetchGeofences: () => {},
      signOut: () => {}
    };

    const mockDispatch = () => {};

    let rendered = false;
    try {
      render(
        <DashboardContext.Provider value={{ state: mockState, dispatch: mockDispatch, data: mockData }}>
          <CommandCenter />
        </DashboardContext.Provider>
      );
      rendered = true;
    } catch (err) {
      expect(err).toBeUndefined();
    }
    expect(rendered).toBe(true);
  });

  it('expone el botón de cerrar sesión cuando el contexto provee signOut', () => {
    const signOut = vi.fn();
    const mockState = {
      category: 'all', selectedEntity: null, isFollowingRoute: false,
      userLocation: null, origin: null, locateUserTrigger: 0, flyToTrigger: null,
      isPlacingOnMap: false, pendingCenter: null, pendingGeofenceConfirm: null,
      alertFocusTrigger: null, routeFocusTrigger: null, localVehicles: [], localGeofences: [],
    };
    const mockData = {
      devices: [], vehicles: [], alerts: [], geofences: [],
      devicesList: [], vehiclesList: [], activeNetworkError: null, fleetLoading: false,
      vehiclesStale: false, devicesStale: false, vehiclesSyncTime: null, devicesSyncTime: null,
      hideEphemeral: () => {}, refetchVehicles: () => {}, refetchGeofences: () => {}, signOut,
    };

    render(
      <DashboardContext.Provider value={{ state: mockState, dispatch: () => {}, data: mockData }}>
        <CommandCenter />
      </DashboardContext.Provider>
    );

    const logout = screen.getByRole('button', { name: /cerrar sesión/i });
    fireEvent.click(logout);
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});