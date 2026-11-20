import { CameraError } from '@/ports/camera-port'
import { createCameraSession, PROMPT_FALLBACK_MS, type CameraSession } from '@/data/camera-session'
import { createFakeCamera, type FakeCameraPort } from '@/test/fake-camera'

/** Lets pending promise callbacks run. */
async function flush() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

function setup(options: Parameters<typeof createFakeCamera>[0] = {}) {
  const port = createFakeCamera({ mode: 'manual', ...options })
  const session = createCameraSession(port)
  return { port, session }
}

function status(session: CameraSession) {
  return session.getSnapshot().status
}

/** Opens and answers the request: a live session with one stream. */
async function openLive(port: FakeCameraPort, session: CameraSession) {
  session.open('environment')
  const stream = port.resolveNext()
  await flush()
  expect(status(session)).toBe('live')
  return stream
}

describe('camera session', () => {
  it('open: warming with the back camera, then live with the stream', async () => {
    const { port, session } = setup()
    const listener = vi.fn()
    session.subscribe(listener)
    session.open('environment')
    expect(status(session)).toBe('warming')
    expect(port.start).toHaveBeenCalledWith('environment')
    const stream = port.resolveNext()
    await flush()
    expect(session.getSnapshot()).toEqual({
      status: 'live',
      stream: stream.media,
      facing: 'environment',
    })
    expect(listener).toHaveBeenCalled()
  })

  it('pending permission: prompt when the Permissions API says prompt; Allow goes live in place', async () => {
    const { port, session } = setup({ permission: 'prompt' })
    session.open('environment')
    await flush()
    expect(status(session)).toBe('prompt')
    port.resolveNext()
    await flush()
    expect(status(session)).toBe('live')
    expect(port.start).toHaveBeenCalledTimes(1)
  })

  it('pending permission without the Permissions API: prompt after 1 s still pending', async () => {
    vi.useFakeTimers()
    try {
      const { port, session } = setup({ permission: 'unknown' })
      session.open('environment')
      await flush()
      expect(status(session)).toBe('warming')
      vi.advanceTimersByTime(PROMPT_FALLBACK_MS - 1)
      expect(status(session)).toBe('warming')
      vi.advanceTimersByTime(1)
      expect(status(session)).toBe('prompt')
      port.resolveNext()
      await flush()
      expect(status(session)).toBe('live')
    } finally {
      vi.useRealTimers()
    }
  })

  it('granted permission and a slow request: stays warming (no helper)', async () => {
    vi.useFakeTimers()
    try {
      const { session } = setup({ permission: 'granted' })
      session.open('environment')
      await flush()
      vi.advanceTimersByTime(5000)
      expect(status(session)).toBe('warming')
    } finally {
      vi.useRealTimers()
    }
  })

  it('denied: the denied status; Try again re-requests through the port', async () => {
    const { port, session } = setup()
    session.open('environment')
    port.rejectNext(new CameraError('denied'))
    await flush()
    expect(status(session)).toBe('denied')
    expect(port.start).toHaveBeenCalledTimes(1)

    session.retry()
    expect(status(session)).toBe('warming')
    expect(port.start).toHaveBeenCalledTimes(2)
    port.resolveNext()
    await flush()
    expect(status(session)).toBe('live')
  })

  it('not found (or any other error): no_camera after one attempt', async () => {
    const { port, session } = setup()
    session.open('environment')
    port.rejectNext(new CameraError('no_camera'))
    await flush()
    expect(status(session)).toBe('no_camera')
    expect(port.start).toHaveBeenCalledTimes(1)

    session.retry()
    port.rejectNext(new Error('weird'))
    await flush()
    expect(status(session)).toBe('no_camera')
  })

  it('hidden stops every track; visible restarts while open', async () => {
    const { port, session } = setup()
    const first = await openLive(port, session)

    session.setVisible(false)
    expect(first.stop).toHaveBeenCalledTimes(1)
    expect(status(session)).toBe('warming')
    expect(session.getSnapshot().stream).toBeNull()
    expect(port.start).toHaveBeenCalledTimes(1)

    session.setVisible(true)
    expect(port.start).toHaveBeenCalledTimes(2)
    port.resolveNext()
    await flush()
    expect(status(session)).toBe('live')
    expect(port.openStreams()).toHaveLength(1)
  })

  it('a restart after visible that fails twice shows the error', async () => {
    const { port, session } = setup()
    await openLive(port, session)
    session.setVisible(false)
    session.setVisible(true)
    port.rejectNext(new CameraError('no_camera'))
    await flush()
    expect(status(session)).toBe('warming')
    expect(port.start).toHaveBeenCalledTimes(3)
    port.rejectNext(new CameraError('no_camera'))
    await flush()
    expect(status(session)).toBe('no_camera')
    expect(port.start).toHaveBeenCalledTimes(3)
  })

  it('hidden while a request is pending: the late stream is stopped, visible asks again', async () => {
    const { port, session } = setup()
    session.open('environment')
    session.setVisible(false)
    const late = port.resolveNext()
    await flush()
    expect(late.stop).toHaveBeenCalled()
    expect(status(session)).toBe('warming')
    session.setVisible(true)
    port.resolveNext()
    await flush()
    expect(status(session)).toBe('live')
    expect(port.openStreams()).toHaveLength(1)
  })

  it('a track ended while live: warming, one retry, then the error variant', async () => {
    const { port, session } = setup()
    const first = await openLive(port, session)
    first.end()
    expect(status(session)).toBe('warming')
    expect(first.stop).toHaveBeenCalled()
    port.rejectNext(new CameraError('no_camera'))
    await flush()
    expect(status(session)).toBe('warming')
    port.rejectNext(new CameraError('denied'))
    await flush()
    expect(status(session)).toBe('denied')
    expect(port.start).toHaveBeenCalledTimes(3)
  })

  it('a track ended while live: the retry can succeed', async () => {
    const { port, session } = setup()
    const first = await openLive(port, session)
    first.end()
    port.resolveNext()
    await flush()
    expect(status(session)).toBe('live')
  })

  it('flip stops the current tracks before requesting the other facing', async () => {
    const { port, session } = setup()
    const first = await openLive(port, session)
    port.start.mockImplementationOnce((facing) => {
      // Two streams never exist at once: the old one is already stopped here.
      expect(first.stop).toHaveBeenCalled()
      expect(facing).toBe('user')
      return new Promise(() => {})
    })
    session.flip()
    expect(port.start).toHaveBeenLastCalledWith('user')
    expect(session.getSnapshot().facing).toBe('user')
    expect(status(session)).toBe('warming')
  })

  it('a flip that fails shows the error variant after one attempt', async () => {
    const { port, session } = setup()
    await openLive(port, session)
    session.flip()
    port.rejectNext(new CameraError('no_camera'))
    await flush()
    expect(status(session)).toBe('no_camera')
    expect(port.start).toHaveBeenCalledTimes(2)
  })

  it('close stops all tracks', async () => {
    const { port, session } = setup()
    const stream = await openLive(port, session)
    session.close()
    expect(stream.stop).toHaveBeenCalled()
    expect(session.getSnapshot()).toMatchObject({ status: 'closed', stream: null })
    expect(port.openStreams()).toHaveLength(0)
    // A track ending after close does nothing.
    stream.end()
    expect(port.start).toHaveBeenCalledTimes(1)
  })

  it('closed while a request is pending: the arriving stream is stopped at once, state stays closed', async () => {
    const { port, session } = setup()
    session.open('environment')
    session.close()
    const late = port.resolveNext()
    await flush()
    expect(late.stop).toHaveBeenCalled()
    expect(status(session)).toBe('closed')
  })

  it('a failure arriving after close is ignored', async () => {
    const { port, session } = setup()
    session.open('environment')
    session.close()
    port.rejectNext(new CameraError('denied'))
    await flush()
    expect(status(session)).toBe('closed')
  })

  it('denied, then back visible (from Settings): one new attempt', async () => {
    const { port, session } = setup()
    session.open('environment')
    port.rejectNext(new CameraError('denied'))
    await flush()
    session.setVisible(false)
    expect(status(session)).toBe('denied')
    session.setVisible(true)
    expect(status(session)).toBe('warming')
    expect(port.start).toHaveBeenCalledTimes(2)
    port.rejectNext(new CameraError('denied'))
    await flush()
    expect(status(session)).toBe('denied')
    expect(port.start).toHaveBeenCalledTimes(2)
  })

  it('visibility changes while closed start nothing', () => {
    const { port, session } = setup()
    session.setVisible(false)
    session.setVisible(true)
    expect(port.start).not.toHaveBeenCalled()
  })

  it('capture hands the video to the port with the 4:3 aspect', async () => {
    const { port, session } = setup()
    await openLive(port, session)
    const video = document.createElement('video')
    const shot = session.capture(video)
    expect(port.capture).toHaveBeenCalledWith(video, 4 / 3)
    expect(shot.canvas).toBeInstanceOf(HTMLCanvasElement)
  })
})
