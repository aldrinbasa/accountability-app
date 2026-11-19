// Composition root: the only file in src/app that may import adapters and ports (enforced by
// eslint-plugin-boundaries). It wires concrete adapters into the ports that src/data depends on.
import { supabaseBackendAdapter } from '@/adapters/supabase/backend-adapter'
import type { BackendPort } from '@/ports/backend-port'

export const adapters: { backend: BackendPort } = { backend: supabaseBackendAdapter }
