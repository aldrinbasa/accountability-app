import { createContext, useContext } from 'react'
import type { Adapters } from '@/app/composition'

/**
 * The camera port for `CameraHost`: `adapters.camera` in the app (src/app/app.tsx), a fake in tests
 * (src/test/fake-backend.tsx). A type-only import, so nothing here loads the adapters.
 */
export const CameraPortContext = createContext<Adapters['camera'] | null>(null)

export function useCameraPort(): Adapters['camera'] {
  const port = useContext(CameraPortContext)
  if (!port) throw new Error('useCameraPort must be used inside <CameraPortContext.Provider>')
  return port
}
