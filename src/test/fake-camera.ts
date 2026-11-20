import type { CameraFacing, CameraPermission, CameraPort, CameraStream } from '@/ports/camera-port'

export interface FakeCameraStream extends CameraStream {
  facing: CameraFacing
  stop: ReturnType<typeof vi.fn<() => void>>
  /** Fires the stream's `ended` listeners, like a track the system took away. */
  end(): void
  /** True once `stop()` ran. */
  stopped: boolean
}

interface PendingRequest {
  facing: CameraFacing
  resolve: (stream: FakeCameraStream) => void
  reject: (error: unknown) => void
}

export interface FakeCameraPort extends CameraPort {
  start: ReturnType<typeof vi.fn<(facing: CameraFacing) => Promise<CameraStream>>>
  permissionState: ReturnType<typeof vi.fn<() => Promise<CameraPermission>>>
  capture: ReturnType<typeof vi.fn<CameraPort['capture']>>
  /** Every stream handed out, in order. */
  streams: FakeCameraStream[]
  /** Requests not yet answered (manual mode). */
  pending: PendingRequest[]
  /** Answers the oldest pending request with a new stream. */
  resolveNext(): FakeCameraStream
  /** Fails the oldest pending request. */
  rejectNext(error: unknown): void
  /** Streams not stopped yet. */
  openStreams(): FakeCameraStream[]
}

export function createFakeStream(facing: CameraFacing): FakeCameraStream {
  const listeners = new Set<() => void>()
  const stream: FakeCameraStream = {
    facing,
    media: { id: `media-${Math.random().toString(36).slice(2)}` } as unknown as MediaStream,
    stopped: false,
    stop: vi.fn(() => {
      stream.stopped = true
    }),
    onEnded(callback) {
      listeners.add(callback)
      return () => {
        listeners.delete(callback)
      }
    },
    end() {
      for (const listener of [...listeners]) listener()
    },
  }
  return stream
}

/**
 * A `CameraPort` for tests. `auto` (default) answers every start at once with a new stream and reads
 * `granted`; `manual` keeps each request pending until `resolveNext` / `rejectNext`.
 */
export function createFakeCamera(
  options: { mode?: 'auto' | 'manual'; permission?: CameraPermission } = {},
): FakeCameraPort {
  const { mode = 'auto', permission = 'granted' } = options
  const streams: FakeCameraStream[] = []
  const pending: PendingRequest[] = []

  const port: FakeCameraPort = {
    streams,
    pending,
    start: vi.fn((facing: CameraFacing) => {
      if (mode === 'auto') {
        const stream = createFakeStream(facing)
        streams.push(stream)
        return Promise.resolve(stream)
      }
      return new Promise<CameraStream>((resolve, reject) => {
        pending.push({ facing, resolve, reject })
      })
    }),
    permissionState: vi.fn(() => Promise.resolve(permission)),
    capture: vi.fn(() => ({
      canvas: document.createElement('canvas'),
      capturedAt: new Date(),
    })),
    resolveNext() {
      const request = pending.shift()
      if (!request) throw new Error('no pending camera request')
      const stream = createFakeStream(request.facing)
      streams.push(stream)
      request.resolve(stream)
      return stream
    },
    rejectNext(error) {
      const request = pending.shift()
      if (!request) throw new Error('no pending camera request')
      request.reject(error)
    },
    openStreams: () => streams.filter((stream) => !stream.stopped),
  }
  return port
}
