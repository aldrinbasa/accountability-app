import { createContext, useContext } from 'react'

/** What the Plan sheet opens for: adding (Commitment pre-selected), or editing one item. */
export type PlanSheetRequest = { mode: 'add' } | { mode: 'edit'; commitmentId: string }

export type OpenPlanSheet = (request: PlanSheetRequest) => void

export const PlanSheetContext = createContext<OpenPlanSheet | null>(null)

/**
 * `openPlanSheet({ mode: 'add' } | { mode: 'edit', commitmentId })` from the Plan sheet host that
 * Today mounts once. Throws outside a `PlanSheetHost`.
 */
export function usePlanSheet(): { openPlanSheet: OpenPlanSheet } {
  const openPlanSheet = useContext(PlanSheetContext)
  if (!openPlanSheet) throw new Error('usePlanSheet must be used inside a PlanSheetHost')
  return { openPlanSheet }
}
