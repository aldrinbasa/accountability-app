import type { AuthUser } from '@/domain/auth'
import { createAuthSessionStore } from '@/data/auth-session'
import { createFakeBackend, TEST_USER } from '@/test/fake-backend'

describe('createAuthSessionStore', () => {
  it('getSession rejecting → signed-out', async () => {
    const backend = createFakeBackend()
    backend.getSession = vi.fn(async () => {
      throw new Error('storage broken')
    })
    const store = createAuthSessionStore(backend)
    store.start()
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe('signed-out'))
  })

  it('a change event beats a slower getSession(): null event first, then a user → stays signed-out', async () => {
    let resolveSession!: (user: AuthUser | null) => void
    const backend = createFakeBackend()
    backend.getSession = vi.fn(
      () =>
        new Promise<AuthUser | null>((resolve) => {
          resolveSession = resolve
        }),
    )
    const store = createAuthSessionStore(backend)
    store.start()
    expect(store.getSnapshot().status).toBe('loading')

    backend.emit(null)
    expect(store.getSnapshot().status).toBe('signed-out')

    resolveSession(TEST_USER)
    await Promise.resolve()
    await Promise.resolve()
    expect(store.getSnapshot().status).toBe('signed-out')
  })
})
