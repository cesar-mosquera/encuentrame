export const formatTimestamp = (ts) => {
  if (!ts) return '--';
  if (ts === 'En línea' || ts === 'Ahora') return ts;
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (isToday) return `Hoy ${timeStr}`;
    
    const dateStr = d.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
    return `${dateStr} ${timeStr}`;
  } catch {
    return ts;
  }
};
