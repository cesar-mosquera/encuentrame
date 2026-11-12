import L from 'leaflet';

const iconCache = new Map();

export const getCachedIcon = (key, factory) => {
  if (!iconCache.has(key)) {
    iconCache.set(key, factory());
  }
  return iconCache.get(key);
};

export const createUserLocationIcon = () => getCachedIcon('user-location', () => new L.DivIcon({
  className: 'user-location-pin',
  html: '<div class="user-location-dot"><span></span></div>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
}));

export const createOriginIcon = () => getCachedIcon('origin-pin', () => new L.DivIcon({
  className: 'origin-pin',
  html: '<div class="origin-flag"><span></span></div>',
  iconSize: [26, 34],
  iconAnchor: [13, 32],
}));

export const escapeHtml = (str) => {
  if (typeof str !== 'string') return String(str || '');
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
};

export const createHeroPinIcon = (name, id, baseLayer = 'satellite') => {
  const isDark = baseLayer === 'satellite' || baseLayer === 'dark';
  const primary = isDark ? '#00E676' : '#EF4444'; // Green on dark, Red on light
  const secondary = isDark ? '#00B4D8' : '#DC2626';
  const tertiary = isDark ? '#0096C9' : '#991B1B';
  const glow = isDark ? 'rgba(0, 240, 255' : 'rgba(239, 68, 68'; // For rgb() injections
  const greenGlow = isDark ? 'rgba(0,230,118' : 'rgba(220,38,38';

  return getCachedIcon(`hero-${id}-${name}-${baseLayer}`, () => new L.DivIcon({
  className: 'custom-vehicle-pin',
  html: `
    <div style="position: relative; display: flex; flex-direction: column; align-items: center; cursor: pointer;">
      <div style="
        background: linear-gradient(135deg, rgba(16, 23, 38, 0.98) 0%, rgba(10, 15, 26, 0.95) 100%);
        border: 1px solid ${glow}, 0.6);
        padding: 5px 12px;
        border-radius: 10px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.8), 0 0 15px ${glow}, 0.3), 0 0 30px ${greenGlow},0.15);
        text-align: center;
        margin-bottom: 8px;
        white-space: nowrap;
        backdrop-filter: blur(10px);
      ">
        <div style="font-size: 12px; font-weight: 800; color: #ffffff; line-height: 1.2; text-shadow: 0 0 10px ${glow},0.5);">${escapeHtml(name)}</div>
        <div style="font-size: 9px; color: #475569; font-family: monospace; letter-spacing: 0.5px;">ID: ${escapeHtml(id)}</div>
      </div>
      <div style="position: relative; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;">
        <div style="
          position: absolute; width: 52px; height: 52px; border-radius: 50%;
          background: radial-gradient(circle, ${glow}, 0.25) 0%, ${greenGlow}, 0.1) 70%, transparent 100%);
          box-shadow: 0 0 25px ${greenGlow},0.4), 0 0 50px ${glow},0.2); animation: pulse 2s infinite;
        "></div>
        <div style="
          position: absolute; width: 44px; height: 44px; border-radius: 50%;
          background: ${glow}, 0.15); box-shadow: 0 0 20px ${glow},0.3); animation: pulse 2s infinite 0.5s;
        "></div>
        <div style="
          width: 34px; height: 34px; background: linear-gradient(135deg, ${primary} 0%, ${secondary} 50%, ${tertiary} 100%);
          border-radius: 50% 50% 50% 0; transform: rotate(-45deg); box-shadow: 0 0 20px ${glow}, 0.9), 0 0 40px ${greenGlow},0.4);
          border: 2px solid #ffffff; display: flex; align-items: center; justify-content: center; position: relative;
        ">
          <div style="
            position: absolute; inset: 0; border-radius: 50% 50% 50% 0;
            background: linear-gradient(135deg, rgba(255,255,255,0.3) 0%, transparent 50%); transform: rotate(-45deg);
          "></div>
          <svg style="transform: rotate(45deg); width: 18px; height: 18px; fill: none; stroke: #0A0F1A; stroke-width: 2.5;" viewBox="0 0 24 24">
            <circle cx="18.5" cy="17.5" r="3.5" />
            <circle cx="5.5" cy="17.5" r="3.5" />
            <circle cx="15" cy="5" r="1" />
            <path d="M12 17.5V14l-3-3 4-3 2 3h2" />
          </svg>
        </div>
      </div>
    </div>
  `,
  iconSize: [120, 95],
  iconAnchor: [60, 85],
}));
};

export const createFleetPinIcon = (status, baseLayer = 'satellite') => {
  const isDark = baseLayer === 'satellite' || baseLayer === 'dark';
  
  // High contrast palette depending on map brightness
  let color;
  if (isDark) {
    color = status === 'active' ? '#00E676' : status === 'stopped' ? '#F59E0B' : '#64748B';
  } else {
    color = status === 'active' ? '#EF4444' : status === 'stopped' ? '#D97706' : '#475569'; // Red for active in Light Mode
  }

  const glowColor = status === 'active' ? (isDark ? 'rgba(0,230,118,0.3)' : 'rgba(239,68,68,0.3)') 
                  : status === 'stopped' ? (isDark ? 'rgba(245,158,11,0.3)' : 'rgba(217,119,6,0.3)') 
                  : 'rgba(100,116,139,0.2)';

  return getCachedIcon(`fleet-${status}-${baseLayer}`, () => new L.DivIcon({
    className: 'mini-vehicle-pin',
    html: `
      <div style="position: relative; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer;">
        <div style="
          position: absolute; width: 32px; height: 32px; border-radius: 50%;
          background: radial-gradient(circle, ${glowColor} 0%, transparent 70%);
          box-shadow: 0 0 15px ${glowColor}; animation: pulse 3s infinite;
        "></div>
        <div style="position: absolute; width: 28px; height: 28px; border-radius: 50%; background: ${color}25; border: 1px solid ${color}70;"></div>
        <div style="
          width: 16px; height: 16px; border-radius: 50%; background: linear-gradient(135deg, ${color} 0%, ${color}CC 100%);
          border: 2px solid #ffffff; box-shadow: 0 0 12px ${color}, 0 0 24px ${glowColor}; position: relative;
        ">
          <div style="position: absolute; inset: 0; border-radius: 50%; background: radial-gradient(circle at 30% 30%, rgba(255,255,255,0.4) 0%, transparent 70%);"></div>
        </div>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  }));
};

export const createWaypointIcon = (label, color = '#00E676') => getCachedIcon(`waypoint-${label}-${color}`, () => new L.DivIcon({
  className: 'route-waypoint-pin',
  html: `
    <div style="
      width: 28px; height: 28px; border-radius: 50%; background: linear-gradient(135deg, #0D1424 0%, #0A0F1A 100%);
      border: 2px solid ${color}; color: ${color}; display: flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: 800; box-shadow: 0 0 15px ${color}, 0 0 30px ${color}40; position: relative;
    ">
      <div style="position: absolute; inset: 0; border-radius: 50%; background: radial-gradient(circle, ${color}20 0%, transparent 70%);"></div>
      <span style="position: relative; z-index: 1; text-shadow: 0 0 10px ${color};">${label}</span>
    </div>
  `,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
}));

export const createHeadingIcon = (bearing = 0) => {
  const roundedBearing = Math.round(Number(bearing) || 0);
  return getCachedIcon(`heading-${roundedBearing}`, () => new L.DivIcon({
    className: 'heading-arrow-pin',
    html: `<div class="heading-arrow" style="transform: rotate(${roundedBearing}deg)">▲</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  }));
};

export const sanitizeColorSafe = (color) => {
  if (typeof color !== 'string') return '#00E676';
  const trimmed = color.trim();
  if (/^#([0-9a-fA-F]{3}){1,2}$/.test(trimmed) || /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)$/.test(trimmed)) {
    return trimmed;
  }
  return '#00E676';
};

export const createZoneLabel = (name, rawColor = '#00E676') => {
  const color = sanitizeColorSafe(rawColor);
  return getCachedIcon(`zone-${name}-${color}`, () => new L.DivIcon({
    className: 'zone-label-icon',
    html: `
      <div style="
        background: linear-gradient(135deg, rgba(16, 23, 38, 0.95) 0%, rgba(10, 15, 26, 0.9) 100%);
        border: 1px dashed ${color}; color: ${color}; padding: 4px 10px; border-radius: 8px; font-size: 10px; font-weight: 700;
        white-space: nowrap; box-shadow: 0 0 15px ${color}40, 0 0 30px ${color}20; backdrop-filter: blur(8px); letter-spacing: 0.5px;
      ">
        ${escapeHtml(name)}
      </div>
    `,
    iconSize: [90, 28],
    iconAnchor: [45, 14],
  }));
};

export const createAlertIncidentIcon = (severity) => {
  const isCritical = severity === 'critical';
  const color = isCritical ? '#FF3366' : '#F59E0B';
  return getCachedIcon(`alert-${severity}`, () => new L.DivIcon({
    className: 'alert-incident-pin',
    html: `
      <div style="position: relative; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; cursor: pointer;">
        <div style="
          position: absolute; width: 34px; height: 34px; border-radius: 50%;
          background: ${color}35; box-shadow: 0 0 16px ${color}; animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;
        "></div>
        <div style="
          width: 24px; height: 24px; border-radius: 50%; background: #0D1424; border: 2px solid ${color};
          display: flex; align-items: center; justify-content: center; box-shadow: 0 0 12px ${color}; font-size: 11px;
        ">
          ${isCritical ? '!' : 'ALERTA'}
        </div>
      </div>
    `,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  }));
};
