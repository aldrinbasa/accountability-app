import { cameraAdapter, classifyCameraError } from '@/adapters/camera/camera-adapter'
import { CameraError } from '@/ports/camera-port'

class FakeTrack extends EventTarget {
  stop = vi.fn()
}

function fakeMedia(tracks: FakeTrack[] = [new FakeTrack()]): MediaStream {
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks,
  } as unknown as MediaStream
}

function domError(name: string): DOMException {
  return new DOMException('nope', name)
}

function setNavigator(key: 'mediaDevices' | 'permissions', value: unknown) {
  Object.defineProperty(navigator, key, { configurable: true, value })
}

afterEach(() => {
  setNavigator('mediaDevices', undefined)
  setNavigator('permissions', undefined)
  vi.restoreAllMocks()
})

describe('cameraAdapter.start', () => {
  it('asks for video only, the facing as ideal, with a 4:3 size hint', async () => {
    const getUserMedia = vi.fn().mockResolvedValue(fakeMedia())
    setNavigator('mediaDevices', { getUserMedia })
    await cameraAdapter.start('environment')
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1440 },
      },
    })
  })

  it('stop() stops every track once; onEnded hears a track the system ended', async () => {
    const track = new FakeTrack()
    setNavigator('mediaDevices', { getUserMedia: vi.fn().mockResolvedValue(fakeMedia([track])) })
    const stream = await cameraAdapter.start('user')
    const ended = vi.fn()
    const off = stream.onEnded(ended)
    track.dispatchEvent(new Event('ended'))
    expect(ended).toHaveBeenCalledTimes(1)
    off()
    track.dispatchEvent(new Event('ended'))
    expect(ended).toHaveBeenCalledTimes(1)
    stream.stop()
    stream.stop()
    expect(track.stop).toHaveBeenCalledTimes(1)
  })

  it('no navigator.mediaDevices: no_camera', async () => {
    await expect(cameraAdapter.start('environment')).rejects.toMatchObject({
      name: 'CameraError',
      failure: 'no_camera',
    })
  })

  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'no_camera'],
    ['OverconstrainedError', 'no_camera'],
    ['NotReadableError', 'no_camera'],
    ['AbortError', 'no_camera'],
  ])('%s maps to %s', async (name, failure) => {
    setNavigator('mediaDevices', { getUserMedia: vi.fn().mockRejectedValue(domError(name)) })
    const error = await cameraAdapter.start('environment').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(CameraError)
    expect((error as CameraError).failure).toBe(failure)
  })

  it('anything else is no_camera', () => {
    expect(classifyCameraError('weird')).toBe('no_camera')
    expect(classifyCameraError(new TypeError('x'))).toBe('no_camera')
  })
})

describe('cameraAdapter.permissionState', () => {
  it('reads the Permissions API', async () => {
    const query = vi.fn().mockResolvedValue({ state: 'prompt' })
    setNavigator('permissions', { query })
    expect(await cameraAdapter.permissionState()).toBe('prompt')
    expect(query).toHaveBeenCalledWith({ name: 'camera' })
  })

  it('unknown where the API is missing or throws', async () => {
    expect(await cameraAdapter.permissionState()).toBe('unknown')
    setNavigator('permissions', { query: vi.fn().mockRejectedValue(new TypeError('camera')) })
    expect(await cameraAdapter.permissionState()).toBe('unknown')
  })
})

describe('cameraAdapter.capture', () => {
  it('draws the center 4:3 crop of the current frame and stamps the capture time', () => {
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D)
    const video = document.createElement('video')
    Object.defineProperty(video, 'videoWidth', { value: 1080 })
    Object.defineProperty(video, 'videoHeight', { value: 1440 })
    const before = Date.now()
    const { canvas, capturedAt } = cameraAdapter.capture(video, 4 / 3)
    expect(canvas.width).toBe(1080)
    expect(canvas.height).toBe(810)
    expect(drawImage).toHaveBeenCalledWith(video, 0, 315, 1080, 810, 0, 0, 1080, 810)
    expect(capturedAt.getTime()).toBeGreaterThanOrEqual(before)
  })
})
