// Composition root: the only file in src/app that may import adapters and ports (enforced by
// eslint-plugin-boundaries). It wires concrete adapters into the ports that repositories in
// src/data depend on. Story 1.3 adds BackendPort and its Supabase adapter here.
import { supabase } from '@/adapters/supabase/client'

export const adapters = { supabase } as const
