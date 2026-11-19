import {
  readDevice,
  removeDeviceKeysWithPrefix,
  resetDeviceMemory,
  writeDevice,
} from '@/data/device-storage'

function blockStorage(storage: Storage) {
  for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
    vi.spyOn(storage, method).mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  resetDeviceMemory()
})

describe('device storage', () => {
  it('round-trips through localStorage; null removes', () => {
    expect(readDevice('proofy.a')).toBeNull()
    writeDevice('proofy.a', '1')
    expect(localStorage.getItem('proofy.a')).toBe('1')
    expect(readDevice('proofy.a')).toBe('1')
    writeDevice('proofy.a', null)
    expect(localStorage.getItem('proofy.a')).toBeNull()
    expect(readDevice('proofy.a')).toBeNull()
  })

  it('uses sessionStorage for the session area', () => {
    writeDevice('proofy.s', 'x', 'session')
    expect(sessionStorage.getItem('proofy.s')).toBe('x')
    expect(localStorage.getItem('proofy.s')).toBeNull()
    expect(readDevice('proofy.s', 'session')).toBe('x')
    expect(readDevice('proofy.s')).toBeNull()
  })

  it('falls back to memory when storage is blocked, removals included', () => {
    localStorage.setItem('proofy.b', 'old')
    blockStorage(localStorage)
    writeDevice('proofy.b', 'new')
    expect(readDevice('proofy.b')).toBe('new')
    writeDevice('proofy.b', null)
    expect(readDevice('proofy.b')).toBeNull()
    vi.restoreAllMocks()
    // The blocked removal still reads as gone, though storage kept the old value.
    expect(localStorage.getItem('proofy.b')).toBe('old')
    expect(readDevice('proofy.b')).toBeNull()
  })

  it('a later successful write replaces the memory copy', () => {
    blockStorage(localStorage)
    writeDevice('proofy.c', 'memory')
    vi.restoreAllMocks()
    writeDevice('proofy.c', 'stored')
    expect(localStorage.getItem('proofy.c')).toBe('stored')
    expect(readDevice('proofy.c')).toBe('stored')
  })

  it('removes every key with a prefix, from storage and from memory, and keeps the rest', () => {
    localStorage.setItem('proofy.count.g1', '2')
    localStorage.setItem('proofy.count.g2', '3')
    localStorage.setItem('proofy.other', 'keep')
    blockStorage(localStorage)
    writeDevice('proofy.count.g3', '4')
    vi.restoreAllMocks()

    removeDeviceKeysWithPrefix('proofy.count.')
    expect(localStorage.getItem('proofy.count.g1')).toBeNull()
    expect(localStorage.getItem('proofy.count.g2')).toBeNull()
    expect(readDevice('proofy.count.g3')).toBeNull()
    expect(localStorage.getItem('proofy.other')).toBe('keep')
  })

  it('reads null and writes nothing when storage throws on every access', () => {
    blockStorage(localStorage)
    expect(readDevice('proofy.d')).toBeNull()
    expect(() => removeDeviceKeysWithPrefix('proofy.')).not.toThrow()
  })
})
