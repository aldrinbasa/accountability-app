import { scaledSize } from '@/domain/checkin'
import type { ImageEncodePort } from '@/ports/image-encode-port'

/** A WASM WebP encoder: RGBA pixels in, WebP bytes out (quality 0 to 100). */
export type WasmWebpEncode = (data: ImageData, quality: number) => Promise<ArrayBuffer>

export interface WebpEncoderDeps {
  /** A blank canvas to draw the scaled frame on. */
  createCanvas: () => HTMLCanvasElement
  /** Loads the WASM encoder (lazily: only browsers without canvas WebP pay for it). */
  loadWasmEncoder: () => Promise<WasmWebpEncode>
}

const WEBP = 'image/webp'

async function loadJsquash(): Promise<WasmWebpEncode> {
  const { default: encode } = await import('@jsquash/webp/encode')
  return (data, quality) => encode(data, { quality })
}

const DEFAULT_DEPS: WebpEncoderDeps = {
  createCanvas: () => document.createElement('canvas'),
  loadWasmEncoder: loadJsquash,
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), WEBP, quality)
    } catch {
      resolve(null)
    }
  })
}

/**
 * The WebP `ImageEncodePort` (Story 3.2, AD-13): draws the source scaled to the long edge (never
 * up), asks the canvas for WebP, and when the browser hands back another type (Safari makes PNG)
 * falls back to `@jsquash/webp`, loaded on first use.
 */
export function createWebpEncoder(deps: WebpEncoderDeps = DEFAULT_DEPS): ImageEncodePort {
  let wasm: Promise<WasmWebpEncode> | null = null
  return {
    async encodeWebp(source, longEdge, quality) {
      const { width, height } = scaledSize(source.width, source.height, longEdge)
      if (width === 0 || height === 0) throw new Error('Nothing to encode: the frame is empty')
      const canvas = deps.createCanvas()
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('No 2D canvas context')
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(source, 0, 0, width, height)

      const blob = await canvasBlob(canvas, quality)
      if (blob && blob.type === WEBP) return blob

      wasm ??= deps.loadWasmEncoder().catch((error: unknown) => {
        wasm = null
        throw error
      })
      const encode = await wasm
      const bytes = await encode(
        context.getImageData(0, 0, width, height),
        Math.round(quality * 100),
      )
      return new Blob([bytes], { type: WEBP })
    },
  }
}

export const webpEncoder: ImageEncodePort = createWebpEncoder()
