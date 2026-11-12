import React from 'react';
import { Signal, Wifi, LogOut, Menu } from 'lucide-react';

export const HeaderBar = ({ category, onCategoryChange, lastSyncLabel, onLogout, onMenuClick }) => {
  return (
    <div className="reference-dashboard-header dashboard-header relative z-20 flex min-h-[50px] sm:min-h-[58px] max-w-full items-center justify-between gap-1 sm:gap-3 overflow-hidden border-b border-[rgba(45,212,191,0.2)] bg-[rgba(4,9,14,0.75)] backdrop-blur-md px-1.5 sm:px-6 py-1.5 sm:py-3 shadow-[0_4px_30px_rgba(0,0,0,0.5)]">
      <div className="flex shrink-0 min-w-0 items-center gap-1.5 sm:gap-3">
        <div className="flex h-6 w-6 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-[8px] bg-[rgba(13,148,136,0.15)] border border-[rgba(45,212,191,0.4)] text-[#2dd4bf] shadow-[0_0_10px_rgba(45,212,191,0.2)]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/></svg>
        </div>
        <div className="min-w-0">
          <div className="truncate text-[12px] sm:text-[14px] font-bold tracking-widest uppercase text-[#f8fafc]">RideGuard</div>
          <div className="hidden min-[380px]:block truncate text-[9px] font-mono tracking-[0.2em] text-[#2dd4bf]">
            {category === 'devices' ? 'TELEMETRÍA' : 'FLOTA'}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onMenuClick}
        className="mobile-menu-button shrink-0"
        aria-label="Abrir menú"
      >
        <Menu size={18} />
      </button>

      <div className="hidden min-[310px]:flex shrink-0 items-center rounded-full border border-[rgba(45,212,191,0.2)] bg-[rgba(10,20,30,0.6)] p-[2px] sm:p-[3px]" role="tablist" aria-label="Categoría de vista">
        {[
          { id: 'devices', label: 'Equipos' },
          { id: 'vehicles', label: 'Motos' },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={category === item.id}
            onClick={() => onCategoryChange(item.id)}
            className={`relative min-w-[44px] sm:min-w-[84px] rounded-full px-1.5 sm:px-3 py-[3px] sm:py-[5px] text-[9px] sm:text-[11px] font-bold uppercase tracking-[0.1em] transition-all ${
              category === item.id
                ? 'bg-[rgba(45,212,191,0.15)] text-[#5eead4] border border-[rgba(45,212,191,0.3)] shadow-[inset_0_0_10px_rgba(45,212,191,0.1)]'
                : 'text-[#64748b] hover:text-[#94a3b8] border border-transparent'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
        <div className="header-status hidden min-[340px]:flex items-center gap-1 sm:gap-2 rounded-full border border-[rgba(45,212,191,0.3)] bg-[rgba(13,148,136,0.1)] px-1.5 sm:px-3 py-1 sm:py-1.5 shadow-[0_0_10px_rgba(45,212,191,0.1)]">
          <div className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#a3e635] animate-pulse"></div>
          <span className="hidden min-[420px]:inline text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.1em] text-[#ccfbf1]">
            {lastSyncLabel || 'Sistema activo'}
          </span>
        </div>
        <div className="header-signal-actions hidden items-center gap-2 text-[12px] text-[#94a3b8] md:flex">
          <Signal size={14} className="text-[#2dd4bf]" />
          <Wifi size={14} className="text-[#a3e635]" />
          <span className="font-mono text-[10px] text-[#ccfbf1]">ON</span>
        </div>
        <button
          type="button"
          onClick={onLogout}
          title="Cerrar sesión"
          aria-label="Cerrar sesión"
          className="hidden items-center justify-center rounded-[7px] border border-[#28566a] bg-[#102b38] p-[7px] text-[#66d9d8] transition-colors hover:border-[#35b9c9] hover:text-[#9feeff] sm:flex"
        >
          <LogOut size={15} />
        </button>
      </div>
    </div>
  );
};