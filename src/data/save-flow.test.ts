import { act, renderHook } from '@testing-library/react'
import { BackendError, type BackendErrorCode } from '@/domain/error-codes'
import { canRetry, useSaveFlow, type SaveFlowOptions } from '@/data/save-flow'

afterEach(() => vi.restoreAllMocks())

function setOnline(online: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

type Options = SaveFlowOptions<string, string, 'locked'>

function setup(overrides: Partial<Options> = {}) {
  const run = vi.fn<(input: string) => Promise<string>>(() => Promise.resolve('ok'))
  const onSaved = vi.fn<Options['onSaved']>()
  const options: Options = { run, onSaved, ...overrides }
  const hook = renderHook((props: Options) => useSaveFlow(props), { initialProps: options })
  return { run: options.run, onSaved: options.onSaved, hook }
}

describe('useSaveFlow', () => {
  it('sends the input and reports the result, live, then is not busy', async () => {
    const { run, onSaved, hook } = setup()
    await act(() => hook.result.current.send('a'))
    expect(run).toHaveBeenCalledWith('a')
    expect(onSaved).toHaveBeenCalledWith('ok', 'a', true)
    expect(hook.result.current.busy).toBe(false)
    expect(hook.result.current.isBusy()).toBe(false)
    expect(hook.result.current.failure).toBeNull()
  })

  it('stays busy after a save with holdBusyOnSaved, so nothing sends twice', async () => {
    const { run, hook } = setup({ holdBusyOnSaved: true })
    await act(() => hook.result.current.send('a'))
    expect(hook.result.current.busy).toBe(true)
    await act(() => hook.result.current.send('b'))
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('offline: shows offline, sends nothing, and Retry resends the last input once online', async () => {
    setOnline(false)
    const { run, hook } = setup()
    await act(() => hook.result.current.send('a'))
    expect(run).not.toHaveBeenCalled()
    expect(hook.result.current.failure).toBe('offline')
    setOnline(true)
    await act(async () => {
      expect(hook.result.current.retry()).toBe(true)
    })
    expect(run).toHaveBeenCalledWith('a')
    expect(hook.result.current.failure).toBeNull()
  })

  it('ignores a second send while the first is in flight', async () => {
    const pending = deferred<string>()
    const { run, hook } = setup({ run: vi.fn(() => pending.promise) })
    let first!: Promise<void>
    act(() => {
      first = hook.result.current.send('a')
    })
    expect(hook.result.current.busy).toBe(true)
    await act(() => hook.result.current.send('b'))
    expect(run).toHaveBeenCalledTimes(1)
    pending.resolve('ok')
    await act(() => first)
    expect(hook.result.current.busy).toBe(false)
  })

  it.each<[BackendErrorCode, string]>([
    ['network', 'offline'],
    ['unknown', 'failed'],
    ['invalid_plan', 'failed'],
  ])('a rejected save with %s shows %s without onError', async (code, expected) => {
    const { hook } = setup({ run: vi.fn(() => Promise.reject(new BackendError(code))) })
    await act(() => hook.result.current.send('a'))
    expect(hook.result.current.failure).toBe(expected)
    expect(hook.result.current.busy).toBe(false)
  })

  it("uses the caller's mapping for codes other than network", async () => {
    const onError = vi.fn<NonNullable<Options['onError']>>(() => 'locked')
    const { hook } = setup({
      run: vi.fn(() => Promise.reject(new BackendError('task_locked'))),
      onError,
    })
    await act(() => hook.result.current.send('a'))
    expect(onError).toHaveBeenCalledWith('task_locked', 'a')
    expect(hook.result.current.failure).toBe('locked')
  })

  it('network never reaches the mapping', async () => {
    const onError = vi.fn<NonNullable<Options['onError']>>(() => 'locked')
    const { hook } = setup({
      run: vi.fn(() => Promise.reject(new BackendError('network'))),
      onError,
    })
    await act(() => hook.result.current.send('a'))
    expect(onError).not.toHaveBeenCalled()
    expect(hook.result.current.failure).toBe('offline')
  })

  it('a handled code (null) shows no failure and leaves nothing to retry', async () => {
    const { run, hook } = setup({
      run: vi.fn(() => Promise.reject(new BackendError('invalid_deadline'))),
      onError: () => null,
    })
    await act(() => hook.result.current.send('a'))
    expect(hook.result.current.failure).toBeNull()
    expect(hook.result.current.retry()).toBe(false)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('reset clears the failure and the input Retry would resend', async () => {
    setOnline(false)
    const { hook } = setup()
    await act(() => hook.result.current.send('a'))
    act(() => hook.result.current.reset())
    expect(hook.result.current.failure).toBeNull()
    expect(hook.result.current.retry()).toBe(false)
  })

  it('a save that fails after active went false shows nothing', async () => {
    const pending = deferred<string>()
    const run = vi.fn(() => pending.promise)
    const onSaved = vi.fn<Options['onSaved']>()
    const { hook } = setup({ run, onSaved, active: true })
    let first!: Promise<void>
    act(() => {
      first = hook.result.current.send('a')
    })
    hook.rerender({ run, onSaved, active: false })
    pending.reject(new BackendError('unknown'))
    await act(() => first)
    expect(hook.result.current.failure).toBeNull()
    expect(hook.result.current.busy).toBe(false)
  })

  it('a save that lands after unmount still reports, not live', async () => {
    const pending = deferred<string>()
    const run = vi.fn(() => pending.promise)
    const { onSaved, hook } = setup({ run })
    let first!: Promise<void>
    act(() => {
      first = hook.result.current.send('a')
    })
    hook.unmount()
    pending.resolve('ok')
    await first
    expect(onSaved).toHaveBeenCalledWith('ok', 'a', false)
  })

  it('canRetry is true for offline and failed only', () => {
    expect(canRetry('offline')).toBe(true)
    expect(canRetry('failed')).toBe(true)
    expect(canRetry('locked')).toBe(false)
    expect(canRetry(null)).toBe(false)
  })
})
