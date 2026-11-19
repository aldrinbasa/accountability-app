import { createContext, useContext } from 'react'

/** What the Plan sheet opens for: adding (Commitment pre-selected), or editing one item. */
export type PlanSheetRequest = { mode: 'add' } | { mode: 'edit'; commitmentId: string }

/**
 * Opens the Plan sheet. Focus returns to `opener` when the sheet closes; by default that is whatever
 * has focus now (pass it when the opener is not focused, e.g. a row's Overflow behind its Sheet).
 */
export type OpenPlanSheet = (request: PlanSheetRequest, opener?: HTMLElement | null) => void

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
