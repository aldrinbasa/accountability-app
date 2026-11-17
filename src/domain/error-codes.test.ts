import {
  BackendError,
  ERROR_COPY,
  errorCopy,
  isBackendError,
  isRpcErrorCode,
} from '@/domain/error-codes'

describe('error-code table (AD-14)', () => {
  it('maps the profile codes to copy', () => {
    expect(errorCopy('invalid_display_name')).toBe('Pick a name your friends will recognize.')
    expect(ERROR_COPY.invalid_time_zone).toMatch(/time zone/)
  })

  it('maps the group codes to copy', () => {
    expect(errorCopy('invalid_group_name')).toBe('Give the group a name.')
    expect(isRpcErrorCode('invalid_group_name')).toBe(true)
    expect(isRpcErrorCode('profile_required')).toBe(true)
  })

  it('knows only its own codes', () => {
    expect(isRpcErrorCode('invalid_display_name')).toBe(true)
    expect(isRpcErrorCode('invalid_time_zone')).toBe(true)
    expect(isRpcErrorCode('toString')).toBe(false)
    expect(isRpcErrorCode('something_else')).toBe(false)
    expect(isRpcErrorCode(42)).toBe(false)
  })
})

describe('BackendError', () => {
  it('carries its code', () => {
    const error = new BackendError('network')
    expect(isBackendError(error)).toBe(true)
    expect(error.code).toBe('network')
    expect(isBackendError(new Error('x'))).toBe(false)
  })
})
