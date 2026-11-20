import { createWebpEncoder, type WasmWebpEncode } from '@/adapters/image/webp-encoder'

interface FakeCanvas {
  canvas: HTMLCanvasElement
  drawImage: ReturnType<typeof vi.fn>
  toBlob: ReturnType<typeof vi.fn>
  getImageData: ReturnType<typeof vi.fn>
}

/** A canvas whose `toBlob` answers with a blob of `type` (null = the browser gave nothing). */
function fakeCanvas(type: string | null): FakeCanvas {
  const drawImage = vi.fn()
  const getImageData = vi.fn((_x: number, _y: number, w: number, h: number) => ({
    width: w,
    height: h,
    data: new Uint8ClampedArray(w * h * 4),
  }))
  const toBlob = vi.fn((callback: (blob: Blob | null) => void, _type: string, _q: number) =>
    callback(type === null ? null : new Blob(['x'], { type })),
  )
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage, getImageData }),
    toBlob,
  } as unknown as HTMLCanvasElement
  return { canvas, drawImage, toBlob, getImageData }
}

function source(width: number, height: number): HTMLCanvasElement {
  return { width, height } as HTMLCanvasElement
}

describe('webp encoder', () => {
  it('scales the long edge down to 1080 and 360 and keeps a canvas WebP blob', async () => {
    const made: FakeCanvas[] = []
    const loadWasmEncoder = vi.fn<() => Promise<WasmWebpEncode>>()
    const encoder = createWebpEncoder({
      createCanvas: () => {
        const next = fakeCanvas('image/webp')
        made.push(next)
        return next.canvas
      },
      loadWasmEncoder,
    })
    const frame = source(1920, 1440)

    const full = await encoder.encodeWebp(frame, 1080, 0.8)
    const small = await encoder.encodeWebp(frame, 360, 0.8)

    expect(full.type).toBe('image/webp')
    expect(small.type).toBe('image/webp')
    expect([made[0]?.canvas.width, made[0]?.canvas.height]).toEqual([1080, 810])
    expect([made[1]?.canvas.width, made[1]?.canvas.height]).toEqual([360, 270])
    expect(made[0]?.drawImage).toHaveBeenCalledWith(frame, 0, 0, 1080, 810)
    expect(made[0]?.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.8)
    expect(loadWasmEncoder).not.toHaveBeenCalled()
  })

  it('never upscales a smaller frame', async () => {
    const made: FakeCanvas[] = []
    const encoder = createWebpEncoder({
      createCanvas: () => {
        const next = fakeCanvas('image/webp')
        made.push(next)
        return next.canvas
      },
      loadWasmEncoder: vi.fn(),
    })
    await encoder.encodeWebp(source(640, 480), 1080, 0.8)
    expect([made[0]?.canvas.width, made[0]?.canvas.height]).toEqual([640, 480])
  })

  it('falls back to the WASM encoder when the browser returns another type, loading it once', async () => {
    const wasm = vi.fn<WasmWebpEncode>(async () => new Uint8Array([1, 2, 3]).buffer)
    const loadWasmEncoder = vi.fn(async () => wasm)
    const made: FakeCanvas[] = []
    const encoder = createWebpEncoder({
      createCanvas: () => {
        // Safari: asked for WebP, hands back PNG.
        const next = fakeCanvas('image/png')
        made.push(next)
        return next.canvas
      },
      loadWasmEncoder,
    })

    const full = await encoder.encodeWebp(source(1600, 1200), 1080, 0.8)
    const small = await encoder.encodeWebp(source(1600, 1200), 360, 0.8)

    expect(full.type).toBe('image/webp')
    expect(full.size).toBe(3)
    expect(small.type).toBe('image/webp')
    expect(loadWasmEncoder).toHaveBeenCalledTimes(1)
    expect(made[0]?.getImageData).toHaveBeenCalledWith(0, 0, 1080, 810)
    expect(wasm).toHaveBeenCalledWith(expect.objectContaining({ width: 1080, height: 810 }), 80)
    expect(wasm).toHaveBeenLastCalledWith(expect.objectContaining({ width: 360, height: 270 }), 80)
  })

  it('falls back when the browser gives no blob at all', async () => {
    const wasm = vi.fn<WasmWebpEncode>(async () => new ArrayBuffer(2))
    const encoder = createWebpEncoder({
      createCanvas: () => fakeCanvas(null).canvas,
      loadWasmEncoder: async () => wasm,
    })
    const blob = await encoder.encodeWebp(source(400, 300), 360, 0.8)
    expect(blob.type).toBe('image/webp')
    expect(wasm).toHaveBeenCalledTimes(1)
  })

  it('a failed WASM load rejects and is tried again next time', async () => {
    const loadWasmEncoder = vi
      .fn<() => Promise<WasmWebpEncode>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(async () => new ArrayBuffer(1))
    const encoder = createWebpEncoder({
      createCanvas: () => fakeCanvas('image/png').canvas,
      loadWasmEncoder,
    })
    await expect(encoder.encodeWebp(source(400, 300), 360, 0.8)).rejects.toThrow('offline')
    await expect(encoder.encodeWebp(source(400, 300), 360, 0.8)).resolves.toBeInstanceOf(Blob)
    expect(loadWasmEncoder).toHaveBeenCalledTimes(2)
  })

  it('rejects an empty frame', async () => {
    const encoder = createWebpEncoder({
      createCanvas: () => fakeCanvas('image/webp').canvas,
      loadWasmEncoder: vi.fn(),
    })
    await expect(encoder.encodeWebp(source(0, 0), 1080, 0.8)).rejects.toThrow()
  })
})
