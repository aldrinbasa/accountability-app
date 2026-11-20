// Composition root: the only file in src/app that may import adapters and ports (enforced by
// eslint-plugin-boundaries). It wires concrete adapters into the ports that src/data depends on.
import { cameraAdapter } from '@/adapters/camera/camera-adapter'
import { supabaseBackendAdapter } from '@/adapters/supabase/backend-adapter'
import type { BackendPort } from '@/ports/backend-port'
import type { CameraPort } from '@/ports/camera-port'

export interface Adapters {
  backend: BackendPort
  /** The one camera module (AD-13); the camera session in src/data drives it. */
  camera: CameraPort
}

export const adapters: Adapters = { backend: supabaseBackendAdapter, camera: cameraAdapter }
