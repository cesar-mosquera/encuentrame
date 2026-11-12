import React from 'react';
import { Polyline, Marker } from 'react-leaflet';
import { createWaypointIcon } from './MapIcons';

export const MapRoutesLayer = ({
  activeRoute, // sanitized history route
  routeColor,
}) => {
  if (!activeRoute || activeRoute.length === 0) return null;

  return (
    <>
      <Polyline
        positions={activeRoute}
        pathOptions={{ color: routeColor, weight: 14, opacity: 0.25 }}
      />
      <Polyline
        positions={activeRoute}
        pathOptions={{ color: routeColor, weight: 3.5, opacity: 1 }}
      />

      {/* Waypoint A (Start) and B (End) */}
      <Marker position={activeRoute[0]} icon={createWaypointIcon('A', '#00E676')} />
      <Marker position={activeRoute[activeRoute.length - 1]} icon={createWaypointIcon('B', '#FF3366')} />
    </>
  );
};
