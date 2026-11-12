/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Core dark theme colors
        background: '#0B0F19',
        surface: '#111827',
        surfaceCard: '#151D2E',
        surfaceBorder: 'rgba(255, 255, 255, 0.08)',
        
        // Primary accent colors (cyan/blue theme)
        accent: '#00E5FF',
        accentGlow: 'rgba(0, 229, 255, 0.4)',
        accentLight: '#00F0FF',
        accentDark: '#00B4D8',
        accentDarker: '#0096C9',
        
        // Success colors (green theme)
        success: '#00E676',
        successGlow: 'rgba(0, 230, 118, 0.4)',
        successLight: '#00F088',
        successDark: '#00C853',
        
        // Danger colors (red theme)
        danger: '#FF3366',
        dangerGlow: 'rgba(255, 51, 102, 0.4)',
        dangerLight: '#FF4D7A',
        dangerDark: '#E91E63',
        
        // Warning colors (amber theme)
        warning: '#F59E0B',
        warningGlow: 'rgba(245, 158, 11, 0.4)',
        warningLight: '#FFB74D',
        warningDark: '#FF8F00',
        
        // Text colors
        textMain: '#F1F5F9',
        textMuted: '#94A3B8',
        textDark: '#64748B',
        textDarker: '#475569',
        
        // Specialized background colors
        glass: 'rgba(255, 255, 255, 0.05)',
        glassLight: 'rgba(255, 255, 255, 0.08)',
        glassDark: 'rgba(0, 0, 0, 0.3)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['Fira Code', 'Consolas', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'pulse-fast': 'pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
        'float': 'float 3s ease-in-out infinite',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px rgba(0, 229, 255, 0.2)' },
          '100%': { boxShadow: '0 0 20px rgba(0, 229, 255, 0.6), 0 0 30px rgba(0, 229, 255, 0.3)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-5px)' },
        },
      },
      boxShadow: {
        'glow-cyan': '0 0 20px rgba(0, 229, 255, 0.3)',
        'glow-green': '0 0 20px rgba(0, 230, 118, 0.3)',
        'glow-red': '0 0 20px rgba(255, 51, 102, 0.3)',
        'glow-amber': '0 0 20px rgba(245, 158, 11, 0.3)',
        'inner-glow': 'inset 0 0 20px rgba(0, 229, 255, 0.1)',
      },
    },
  },
  safelist: [
    'bg-background',
    'bg-surface',
    'bg-surfaceCard',
    'text-textMain',
    'text-textMuted',
    'font-sans',
    'font-mono',
    'bg-[#0B0F19]',
    'bg-[#080C14]',
    'border-surfaceBorder',
    'border-accent',
    'bg-accent/20',
    'bg-accent/10',
    'shadow-glow-cyan',
    'shadow-glow-green',
    'shadow-glow-red',
    'shadow-glow-amber',
    'animate-pulse-slow',
    'animate-pulse-fast',
    'animate-glow',
    'animate-float',
  ],
}