import {
  BackendError,
  backendErrorCode,
  ERROR_COPY,
  errorCopy,
  isBackendError,
  isRpcErrorCode,
} from '@/domain/error-codes'

describe('error-code table (AD-14)', () => {
  it('maps the vote codes to copy (Story 5.2)', () => {
    expect(errorCopy('vote_closed')).toBe("That vote's already wrapped up.")
    expect(errorCopy('undo_expired')).toBe("That vote's already final.")
    expect(errorCopy('not_eligible')).toBe("You can't vote on this one.")
    expect(errorCopy('already_voted')).toBe('You already voted on this one.')
    expect(errorCopy('invalid_vote')).toBe("Pick Counts or Doesn't count.")
  })

  it('maps the profile codes to copy', () => {
    expect(errorCopy('invalid_display_name')).toBe('Pick a name your friends will recognize.')
    expect(ERROR_COPY.invalid_time_zone).toMatch(/time zone/)
  })

  it('maps the group codes to copy', () => {
    expect(errorCopy('invalid_group_name')).toBe('Give the group a name.')
    expect(isRpcErrorCode('invalid_group_name')).toBe(true)
    expect(isRpcErrorCode('profile_required')).toBe(true)
  })

  it('maps the invite and join codes to copy', () => {
    for (const code of [
      'not_admin',
      'not_member',
      'invite_not_found',
      'invite_expired',
      'group_full',
    ]) {
      expect(isRpcErrorCode(code)).toBe(true)
    }
    expect(errorCopy('invite_not_found')).toBe(
      "That invite code doesn't work. Check it with whoever sent it.",
    )
    expect(errorCopy('group_full')).toMatch(/10 is the max/)
  })

  it('maps the leave and remove codes to copy', () => {
    expect(isRpcErrorCode('cannot_remove_self')).toBe(true)
    expect(errorCopy('cannot_remove_self')).toMatch(/Leave group/)
  })

  it('maps the activity code to copy', () => {
    expect(isRpcErrorCode('invalid_activity')).toBe(true)
    expect(errorCopy('invalid_activity')).toBe('Pick an activity.')
  })

  it('maps the plan codes to copy', () => {
    for (const code of ['invalid_plan', 'invalid_end_date', 'schedule_type_locked']) {
      expect(isRpcErrorCode(code)).toBe(true)
    }
    expect(errorCopy('invalid_end_date')).toBe('Pick a later end date.')
    expect(errorCopy('schedule_type_locked')).toMatch(/schedule type/)
  })

  it('maps the task codes to copy', () => {
    for (const code of ['invalid_deadline', 'task_locked', 'not_found']) {
      expect(isRpcErrorCode(code)).toBe(true)
    }
    expect(errorCopy('invalid_deadline')).toBe('Pick a deadline from today to Sunday.')
  })

  it('maps the commitment edit and end code to copy', () => {
    expect(isRpcErrorCode('commitment_ended')).toBe(true)
    expect(errorCopy('commitment_ended')).toBe("That's already wrapped up.")
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

  it('backendErrorCode reads a BackendError code and calls anything else unknown', () => {
    expect(backendErrorCode(new BackendError('not_admin'))).toBe('not_admin')
    expect(backendErrorCode(new BackendError('network'))).toBe('network')
    expect(backendErrorCode(new Error('boom'))).toBe('unknown')
    expect(backendErrorCode('not_admin')).toBe('unknown')
    expect(backendErrorCode(undefined)).toBe('unknown')
  })

  it('maps the check-in codes to copy (Story 3.2)', () => {
    expect(errorCopy('bad_capture_time')).toBe(
      "Your phone's clock is ahead. Fix its date and time, then retake the photo.",
    )
    expect(errorCopy('week_locked')).toBe("That week has locked, so this photo can't count.")
    expect(errorCopy('photo_missing')).toBe("The photo didn't finish uploading. Tap Retry.")
    expect(errorCopy('checkin_conflict')).toBe('That photo was already posted.')
    expect(errorCopy('invalid_caption')).toBe('Keep the caption to 80 characters.')
  })
})
