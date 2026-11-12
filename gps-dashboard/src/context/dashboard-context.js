import { createContext, useContext } from 'react'

export const DashboardContext = createContext(null)

export const useDashboardContext = () => {
  const ctx = useContext(DashboardContext)
  if (!ctx) throw new Error('useDashboardContext debe usarse dentro de <DashboardProvider>')
  return ctx
}
