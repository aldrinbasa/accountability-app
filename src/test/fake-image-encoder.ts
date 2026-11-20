import type { ImageEncodePort } from '@/ports/image-encode-port'

export interface FakeImageEncoder extends ImageEncodePort {
  encodeWebp: ReturnType<typeof vi.fn<ImageEncodePort['encodeWebp']>>
}

/** An `ImageEncodePort` for tests: a tiny WebP blob per call whose text is the long edge. */
export function createFakeEncoder(): FakeImageEncoder {
  return {
    encodeWebp: vi.fn(
      async (_source: HTMLCanvasElement, longEdge: number) =>
        new Blob([String(longEdge)], { type: 'image/webp' }),
    ),
  }
}
