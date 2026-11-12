// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MapFlyToHandler, RouteFocusHandler } from '../components/map/MapControllers';
import { MapNavigationLayer } from '../components/map/MapNavigationLayer';
import { MapGeofences } from '../components/map/MapGeofences';

// Mocks
const mockMap = {
  setView: vi.fn(),
  flyTo: vi.fn(),
  fitBounds: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
};

vi.mock('react-leaflet', async () => {
  const actual = await vi.importActual('react-leaflet');
  return {
    ...actual,
    useMap: () => mockMap,
    Marker: ({ children, position }) => <div data-testid="mock-marker" data-position={JSON.stringify(position)}>{children}</div>,
    Circle: ({ center, radius }) => <div data-testid="mock-circle" data-center={JSON.stringify(center)} data-radius={radius} />,
    Polyline: ({ positions }) => <div data-testid="mock-polyline" data-positions={JSON.stringify(positions)} />,
    Popup: ({ children }) => <div data-testid="mock-popup">{children}</div>,
    Polygon: ({ children, positions }) => <div data-testid="mock-polygon" data-positions={JSON.stringify(positions)}>{children}</div>
  };
});

vi.mock('../lib/routing', () => ({
  fetchDrivingRoute: vi.fn().mockResolvedValue({
    coords: [[0, 0], [1, 1]],
    distanceM: 1000,
    durationS: 600,
  }),
}));

describe('Map Layers and Controllers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('MapControllers', () => {
    it('flies to coordinate when flyToTrigger changes', () => {
      render(
        <MapFlyToHandler flyToTrigger={{ coords: [4.6, -74.0], zoom: 18 }} />
      );
      
      expect(mockMap.flyTo).toHaveBeenCalledWith([4.6, -74.0], 18, { animate: true, duration: 1.5 });
    });

    it('focuses on bounding box when routeFocusTrigger changes', () => {
      render(
        <RouteFocusHandler routeFocusTrigger={{ route: [[4.6, -74.0], [4.7, -74.1]] }} />
      );
      
      expect(mockMap.fitBounds).toHaveBeenCalled();
    });
  });

  describe('MapNavigationLayer', () => {
    it('fetches and renders route when isFollowingRoute is true', async () => {
      await act(async () => {
        render(
          <MapNavigationLayer 
            isFollowingRoute={true} 
            originPosition={[4.61, -74.01]}
            targetPosition={[4.6, -74.0]}
          />
        );
      });

      const polylines = await screen.findAllByTestId('mock-polyline');
      expect(polylines.length).toBeGreaterThan(0);
    });
  });

  describe('MapGeofences', () => {
    it('renders active geofences from props', () => {
      const geofences = [
        { id: 'geo1', name: 'Zone A', type: 'circle', center: [4.6, -74.0], radius: 500, active: true },
        { id: 'geo2', name: 'Zone B', type: 'circle', center: [4.7, -74.1], radius: 300, active: false }
      ];

      render(
        <MapGeofences geofences={geofences} pendingCenter={null} selectedVehicle={null} />
      );

      const circles = screen.getAllByTestId('mock-circle');
      expect(circles).toHaveLength(1); // Only active one
      expect(circles[0].getAttribute('data-radius')).toBe('500');
    });
  });
});
