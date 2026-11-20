/**
 * The app's one image encoder (Story 3.2, used again by Story 3.6 avatars). Implemented in
 * src/adapters/image, wired only in src/app/composition.ts.
 */
export interface ImageEncodePort {
  /**
   * Encodes `source` as WebP (about `quality`, 0 to 1) scaled so its long edge is `longEdge` px,
   * never upscaled. The blob's type is always `image/webp`: when the browser's canvas encoder returns
   * another type (Safari), a WASM WebP encoder takes over. Rejects only when neither can encode.
   */
  encodeWebp(source: HTMLCanvasElement, longEdge: number, quality: number): Promise<Blob>
}
