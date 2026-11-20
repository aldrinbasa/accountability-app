import { createContext, useContext } from 'react'
import type { ImageEncodePort } from '@/ports/image-encode-port'

/**
 * The image encoder for the check-in post (and Story 3.6's avatar): `adapters.imageEncoder` in the
 * app (src/app/app.tsx), a fake in tests (src/test/fake-backend.tsx).
 */
export const ImageEncoderContext = createContext<ImageEncodePort | null>(null)

export function useImageEncoder(hook: string): ImageEncodePort {
  const encoder = useContext(ImageEncoderContext)
  if (!encoder) throw new Error(`${hook} must be used inside <ImageEncoderContext.Provider>`)
  return encoder
}
