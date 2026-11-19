import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js'
import type { AuthErrorCode } from '@/domain/auth'
import type { BackendErrorCode } from '@/domain/error-codes'
import { givenNameOf, supabaseBackendAdapter as adapter } from '@/adapters/supabase/backend-adapter'

const auth = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  getSession: vi.fn(),
}))

// A chainable stand-in for supabase.from(...).select(...).eq(...).maybeSingle().
const db = vi.hoisted(() => {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    order: vi.fn(),
    maybeSingle: vi.fn(),
  }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  query.is.mockReturnValue(query)
  return { query, from: vi.fn(() => query), rpc: vi.fn() }
})

vi.mock('@/adapters/supabase/client', () => ({
  supabase: { auth, from: db.from, rpc: db.rpc },
}))

const USER = { id: 'user-1', email: 'jo@example.com' }
const expired = () => new AuthApiError('Token has expired or is invalid', 403, 'otp_expired')

async function codeOf(promise: Promise<unknown>): Promise<AuthErrorCode> {
  try {
    await promise
  } catch (error) {
    return (error as { code: AuthErrorCode }).code
  }
  throw new Error('expected a rejection')
}

beforeEach(() => {
  auth.signInWithOtp.mockReset()
  auth.verifyOtp.mockReset()
  auth.getSession.mockReset()
  db.query.maybeSingle.mockReset()
  db.rpc.mockReset()
})

describe('supabaseBackendAdapter error mapping', () => {
  it('403 otp_expired → code_rejected for the code, link_rejected for the link', async () => {
    auth.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: expired() })
    expect(await codeOf(adapter.verifyEmailCode('jo@example.com', '123456'))).toBe('code_rejected')
    expect(await codeOf(adapter.verifyEmailLink('hash'))).toBe('link_rejected')
  })

  it('429 and over_email_send_rate_limit → rate_limited', async () => {
    auth.signInWithOtp.mockResolvedValueOnce({
      data: {},
      error: new AuthApiError('Too many requests', 429, undefined),
    })
    expect(await codeOf(adapter.sendEmailCode('jo@example.com', 'https://a.test/signin'))).toBe(
      'rate_limited',
    )
    auth.signInWithOtp.mockResolvedValueOnce({
      data: {},
      error: new AuthApiError('Slow down', 400, 'over_email_send_rate_limit'),
    })
    expect(await codeOf(adapter.sendEmailCode('jo@example.com', 'https://a.test/signin'))).toBe(
      'rate_limited',
    )
  })

  it('a fetch that never got a response (status 0) → network', async () => {
    auth.signInWithOtp.mockResolvedValue({
      data: {},
      error: new AuthRetryableFetchError('Failed to fetch', 0),
    })
    expect(await codeOf(adapter.sendEmailCode('jo@example.com', 'https://a.test/signin'))).toBe(
      'network',
    )
    auth.verifyOtp.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthRetryableFetchError('Failed to fetch', 0),
    })
    expect(await codeOf(adapter.verifyEmailCode('jo@example.com', '123456'))).toBe('network')
  })

  it('a 403 on send is not a rejected token → unknown', async () => {
    auth.signInWithOtp.mockResolvedValue({ data: {}, error: expired() })
    expect(await codeOf(adapter.sendEmailCode('jo@example.com', 'https://a.test/signin'))).toBe(
      'unknown',
    )
  })

  it('no user in a successful response → the rejected code', async () => {
    auth.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: null })
    expect(await codeOf(adapter.verifyEmailCode('jo@example.com', '123456'))).toBe('code_rejected')
    expect(await codeOf(adapter.verifyEmailLink('hash'))).toBe('link_rejected')
  })

  it('maps the user and passes the redirect through', async () => {
    auth.verifyOtp.mockResolvedValue({ data: { user: USER, session: {} }, error: null })
    await expect(adapter.verifyEmailCode('jo@example.com', '123456')).resolves.toEqual(USER)
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      email: 'jo@example.com',
      token: '123456',
      type: 'email',
    })

    auth.signInWithOtp.mockResolvedValue({ data: {}, error: null })
    await adapter.sendEmailCode('jo@example.com', 'https://a.test/signin?next=%2Ftoday')
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'jo@example.com',
      options: { emailRedirectTo: 'https://a.test/signin?next=%2Ftoday', shouldCreateUser: true },
    })
  })
})

describe('givenNameOf', () => {
  it('prefers given_name, then the first word of full_name or name', () => {
    expect(givenNameOf({ given_name: 'Josephine', full_name: 'Jo Cruz' })).toBe('Josephine')
    expect(givenNameOf({ full_name: '  Jo Cruz ' })).toBe('Jo')
    expect(givenNameOf({ name: 'Marco Polo' })).toBe('Marco')
    expect(givenNameOf({ given_name: '  ', name: 'Marco' })).toBe('Marco')
  })

  it('has none for email sign-ins', () => {
    expect(givenNameOf({})).toBeNull()
    expect(givenNameOf(undefined)).toBeNull()
    expect(givenNameOf({ given_name: 42 })).toBeNull()
  })

  it('puts it on the signed-in user', async () => {
    auth.verifyOtp.mockResolvedValue({
      data: { user: { ...USER, user_metadata: { given_name: 'Jo' } }, session: {} },
      error: null,
    })
    await expect(adapter.verifyEmailCode('jo@example.com', '123456')).resolves.toEqual({
      ...USER,
      givenName: 'Jo',
    })
  })
})

async function backendCodeOf(promise: Promise<unknown>): Promise<BackendErrorCode> {
  try {
    await promise
  } catch (error) {
    return (error as { code: BackendErrorCode }).code
  }
  throw new Error('expected a rejection')
}

const ROW = { id: 'user-1', display_name: 'Jo', avatar_path: null, time_zone: 'Asia/Manila' }
const PROFILE = { id: 'user-1', displayName: 'Jo', avatarPath: null, timeZone: 'Asia/Manila' }
const pgError = (message: string) => ({ message, code: 'P0001', details: '', hint: '' })

describe('profiles', () => {
  it('reads the own row by the session user id', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: USER } }, error: null })
    db.query.maybeSingle.mockResolvedValue({ data: ROW, error: null, status: 200 })
    await expect(adapter.getMyProfile()).resolves.toEqual(PROFILE)
    expect(db.from).toHaveBeenCalledWith('profiles')
    expect(db.query.eq).toHaveBeenCalledWith('id', 'user-1')
  })

  it('no row (before Setup) → null', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: USER } }, error: null })
    db.query.maybeSingle.mockResolvedValue({ data: null, error: null, status: 200 })
    await expect(adapter.getMyProfile()).resolves.toBeNull()
  })

  it('no session → unknown, never null', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    expect(await backendCodeOf(adapter.getMyProfile())).toBe('unknown')
  })

  it('a getSession error → network when no response came back, else unknown', async () => {
    auth.getSession.mockResolvedValueOnce({
      data: { session: null },
      error: new AuthRetryableFetchError('Failed to fetch', 0),
    })
    expect(await backendCodeOf(adapter.getMyProfile())).toBe('network')
    auth.getSession.mockResolvedValueOnce({
      data: { session: null },
      error: new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found'),
    })
    expect(await backendCodeOf(adapter.getMyProfile())).toBe('unknown')
    expect(db.query.maybeSingle).not.toHaveBeenCalled()
  })

  it('a read that never got a response → network', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: USER } }, error: null })
    db.query.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'TypeError: Failed to fetch', code: '', details: '', hint: '' },
      status: 0,
    })
    expect(await backendCodeOf(adapter.getMyProfile())).toBe('network')
  })

  it('save_profile passes name and zone and maps the returned row', async () => {
    db.rpc.mockResolvedValue({ data: ROW, error: null, status: 200 })
    await expect(adapter.saveProfile('Jo', 'Asia/Manila')).resolves.toEqual(PROFILE)
    expect(db.rpc).toHaveBeenCalledWith('save_profile', {
      p_display_name: 'Jo',
      p_time_zone: 'Asia/Manila',
    })
  })

  it('maps RPC error codes from the message; anything else is unknown', async () => {
    db.rpc.mockResolvedValueOnce({
      data: null,
      error: pgError('invalid_display_name'),
      status: 400,
    })
    expect(await backendCodeOf(adapter.saveProfile(' ', 'UTC'))).toBe('invalid_display_name')
    db.rpc.mockResolvedValueOnce({ data: null, error: pgError('invalid_time_zone'), status: 400 })
    expect(await backendCodeOf(adapter.saveProfile('Jo', 'Mars/Base'))).toBe('invalid_time_zone')
    db.rpc.mockResolvedValueOnce({ data: null, error: pgError('boom'), status: 500 })
    expect(await backendCodeOf(adapter.saveProfile('Jo', 'UTC'))).toBe('unknown')
    db.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'TypeError: Failed to fetch', code: '', details: '', hint: '' },
      status: 0,
    })
    expect(await backendCodeOf(adapter.saveProfile('Jo', 'UTC'))).toBe('network')
  })
})

describe('groups', () => {
  const member = (
    user_id: string,
    role: string,
    ended_at: string | null = null,
    end_reason: string | null = ended_at ? 'left' : null,
    id = `m-${user_id}-${ended_at ?? 'current'}`,
  ) => ({
    id,
    user_id,
    role,
    joined_at: '2026-11-01T10:00:00+00:00',
    ended_at,
    end_reason,
  })

  it('lists current groups with role, join time and current member count, and ended ones', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: USER } }, error: null })
    db.query.select.mockReturnValueOnce(
      Promise.resolve({
        data: [
          {
            id: 'g1',
            name: 'Gym Rats',
            time_zone: 'Asia/Manila',
            memberships: [
              member('user-1', 'admin'),
              member('user-2', 'member'),
              member('user-3', 'member', '2026-11-02T00:00:00+00:00'),
            ],
          },
          // Ended for the caller: RLS still shows the group and their own ended row.
          {
            id: 'g2',
            name: 'Old crew',
            time_zone: 'UTC',
            memberships: [
              member('user-1', 'member', '2026-11-03T00:00:00+00:00', 'left', 'm-old'),
              member('user-1', 'member', '2026-11-05T00:00:00+00:00', 'removed', 'm-last'),
            ],
          },
          // Left once and back in: current, not ended.
          {
            id: 'g3',
            name: 'Back again',
            time_zone: 'UTC',
            memberships: [
              member('user-1', 'member', '2026-11-03T00:00:00+00:00'),
              member('user-1', 'member'),
            ],
          },
        ],
        error: null,
        status: 200,
      }),
    )
    await expect(adapter.listMyGroups()).resolves.toEqual({
      groups: [
        {
          id: 'g1',
          name: 'Gym Rats',
          timeZone: 'Asia/Manila',
          role: 'admin',
          joinedAt: '2026-11-01T10:00:00+00:00',
          memberCount: 2,
        },
        {
          id: 'g3',
          name: 'Back again',
          timeZone: 'UTC',
          role: 'member',
          joinedAt: '2026-11-01T10:00:00+00:00',
          memberCount: 1,
        },
      ],
      ended: [
        {
          membershipId: 'm-last',
          groupId: 'g2',
          name: 'Old crew',
          endReason: 'removed',
          endedAt: '2026-11-05T00:00:00+00:00',
        },
      ],
    })
    expect(db.from).toHaveBeenCalledWith('groups')
  })

  it('a groups read that never got a response → network; no session → unknown', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: USER } }, error: null })
    db.query.select.mockReturnValueOnce(
      Promise.resolve({
        data: null,
        error: { message: 'TypeError: Failed to fetch', code: '', details: '', hint: '' },
        status: 0,
      }),
    )
    expect(await backendCodeOf(adapter.listMyGroups())).toBe('network')
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    expect(await backendCodeOf(adapter.listMyGroups())).toBe('unknown')
  })

  it('create_group passes the name, returns the id and maps its error codes', async () => {
    db.rpc.mockResolvedValueOnce({ data: 'g9', error: null, status: 200 })
    await expect(adapter.createGroup('Gym Rats')).resolves.toBe('g9')
    expect(db.rpc).toHaveBeenCalledWith('create_group', { p_name: 'Gym Rats' })
    db.rpc.mockResolvedValueOnce({ data: null, error: pgError('invalid_group_name'), status: 400 })
    expect(await backendCodeOf(adapter.createGroup(' '))).toBe('invalid_group_name')
    db.rpc.mockResolvedValueOnce({ data: null, error: pgError('profile_required'), status: 400 })
    expect(await backendCodeOf(adapter.createGroup('x'))).toBe('profile_required')
  })
})

describe('invites', () => {
  it('create_invite passes the group and fresh flag and maps the row', async () => {
    db.rpc.mockResolvedValueOnce({
      data: [{ code: 'K7QX2M', expires_at: '2026-11-24T10:00:00+00:00' }],
      error: null,
      status: 200,
    })
    await expect(adapter.createInvite('g1', false)).resolves.toEqual({
      code: 'K7QX2M',
      expiresAt: '2026-11-24T10:00:00+00:00',
    })
    expect(db.rpc).toHaveBeenCalledWith('create_invite', { p_group_id: 'g1', p_new: false })

    db.rpc.mockResolvedValueOnce({ data: null, error: pgError('not_admin'), status: 400 })
    expect(await backendCodeOf(adapter.createInvite('g1', true))).toBe('not_admin')
    db.rpc.mockResolvedValueOnce({ data: null, error: pgError('not_member'), status: 400 })
    expect(await backendCodeOf(adapter.createInvite('g1', true))).toBe('not_member')
    db.rpc.mockResolvedValueOnce({ data: [], error: null, status: 200 })
    expect(await backendCodeOf(adapter.createInvite('g1', true))).toBe('unknown')
  })

  it('get_invite maps the preview; an unknown code and an unknown status are errors', async () => {
    db.rpc.mockResolvedValueOnce({
      data: [
        {
          group_id: 'g9',
          group_name: 'Sunday Reset',
          admin_display_name: 'Sam',
          member_count: 3,
          status: 'valid',
        },
      ],
      error: null,
      status: 200,
    })
    await expect(adapter.getInvite('K7QX2M')).resolves.toEqual({
      groupId: 'g9',
      groupName: 'Sunday Reset',
      adminName: 'Sam',
      memberCount: 3,
      status: 'valid',
    })
    expect(db.rpc).toHaveBeenCalledWith('get_invite', { p_code: 'K7QX2M' })

    db.rpc.mockResolvedValueOnce({ data: null, error: pgError('invite_not_found'), status: 400 })
    expect(await backendCodeOf(adapter.getInvite('ZZZZZZ'))).toBe('invite_not_found')
    db.rpc.mockResolvedValueOnce({
      data: [
        {
          group_id: 'g9',
          group_name: 'x',
          admin_display_name: 'y',
          member_count: 1,
          status: 'odd',
        },
      ],
      error: null,
      status: 200,
    })
    expect(await backendCodeOf(adapter.getInvite('K7QX2M'))).toBe('unknown')
  })

  it('join_group returns the group id and maps its error codes', async () => {
    db.rpc.mockResolvedValueOnce({ data: 'g9', error: null, status: 200 })
    await expect(adapter.joinGroup('K7QX2M')).resolves.toBe('g9')
    expect(db.rpc).toHaveBeenCalledWith('join_group', { p_code: 'K7QX2M' })
    for (const code of ['invite_expired', 'group_full', 'invite_not_found', 'profile_required']) {
      db.rpc.mockResolvedValueOnce({ data: null, error: pgError(code), status: 400 })
      expect(await backendCodeOf(adapter.joinGroup('K7QX2M'))).toBe(code)
    }
    db.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'TypeError: Failed to fetch', code: '', details: '', hint: '' },
      status: 0,
    })
    expect(await backendCodeOf(adapter.joinGroup('K7QX2M'))).toBe('network')
  })
})

describe('members, leave and remove', () => {
  it("lists a group's current members with display names, in handover order", async () => {
    db.query.order.mockReturnValueOnce(db.query).mockResolvedValueOnce({
      data: [
        {
          id: 'm1',
          user_id: 'user-1',
          role: 'admin',
          joined_at: '2026-11-01T10:00:00+00:00',
          profiles: { display_name: 'Jo' },
        },
        {
          id: 'm2',
          user_id: 'user-2',
          role: 'member',
          joined_at: '2026-11-02T10:00:00+00:00',
          profiles: { display_name: 'Sam' },
        },
      ],
      error: null,
      status: 200,
    })
    await expect(adapter.listMembers('g1')).resolves.toEqual([
      {
        membershipId: 'm1',
        userId: 'user-1',
        displayName: 'Jo',
        role: 'admin',
        joinedAt: '2026-11-01T10:00:00+00:00',
      },
      {
        membershipId: 'm2',
        userId: 'user-2',
        displayName: 'Sam',
        role: 'member',
        joinedAt: '2026-11-02T10:00:00+00:00',
      },
    ])
    expect(db.from).toHaveBeenCalledWith('memberships')
    expect(db.query.eq).toHaveBeenCalledWith('group_id', 'g1')
    expect(db.query.is).toHaveBeenCalledWith('ended_at', null)
    expect(db.query.order).toHaveBeenNthCalledWith(1, 'joined_at')
    expect(db.query.order).toHaveBeenNthCalledWith(2, 'id')
  })

  it('leave_group passes the group id and maps its error codes', async () => {
    db.rpc.mockResolvedValueOnce({ data: null, error: null, status: 204 })
    await expect(adapter.leaveGroup('g1')).resolves.toBeUndefined()
    expect(db.rpc).toHaveBeenCalledWith('leave_group', { p_group_id: 'g1' })
    db.rpc.mockResolvedValueOnce({ data: null, error: pgError('not_member'), status: 400 })
    expect(await backendCodeOf(adapter.leaveGroup('g1'))).toBe('not_member')
    db.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'TypeError: Failed to fetch', code: '', details: '', hint: '' },
      status: 0,
    })
    expect(await backendCodeOf(adapter.leaveGroup('g1'))).toBe('network')
  })

  it('remove_member passes the group and user ids and maps its error codes', async () => {
    db.rpc.mockResolvedValueOnce({ data: null, error: null, status: 204 })
    await expect(adapter.removeMember('g1', 'user-2')).resolves.toBeUndefined()
    expect(db.rpc).toHaveBeenCalledWith('remove_member', { p_group_id: 'g1', p_user_id: 'user-2' })
    for (const code of ['not_admin', 'cannot_remove_self', 'not_member']) {
      db.rpc.mockResolvedValueOnce({ data: null, error: pgError(code), status: 400 })
      expect(await backendCodeOf(adapter.removeMember('g1', 'user-2'))).toBe(code)
    }
  })
})

describe('activities', () => {
  it('lists the presets ordered by sort', async () => {
    db.query.order.mockResolvedValueOnce({
      data: [
        { key: 'gym', name: 'Gym', category: 'fitness', sort: 1 },
        { key: 'study', name: 'Study', category: 'mind', sort: 6 },
      ],
      error: null,
      status: 200,
    })
    await expect(adapter.listPresetActivities()).resolves.toEqual([
      { key: 'gym', name: 'Gym', category: 'fitness', sort: 1 },
      { key: 'study', name: 'Study', category: 'mind', sort: 6 },
    ])
    expect(db.from).toHaveBeenCalledWith('preset_activities')
    expect(db.query.order).toHaveBeenCalledWith('sort')
  })

  it('a preset with an unknown category is an error; no response → network', async () => {
    db.query.order.mockResolvedValueOnce({
      data: [{ key: 'gym', name: 'Gym', category: 'cardio', sort: 1 }],
      error: null,
      status: 200,
    })
    expect(await backendCodeOf(adapter.listPresetActivities())).toBe('unknown')
    db.query.order.mockResolvedValueOnce({
      data: null,
      error: { message: 'TypeError: Failed to fetch', code: '', details: '', hint: '' },
      status: 0,
    })
    expect(await backendCodeOf(adapter.listPresetActivities())).toBe('network')
  })

  it("lists a group's activities from group_activity_options", async () => {
    db.query.eq.mockResolvedValueOnce({
      data: [
        {
          id: 'a1',
          group_id: 'g1',
          preset_key: 'gym',
          custom_name: null,
          created_by: 'user-1',
          locked_schedule_type: 'times_per_week',
        },
        {
          id: 'a2',
          group_id: 'g1',
          preset_key: null,
          custom_name: 'Pottery',
          created_by: 'user-2',
          locked_schedule_type: null,
        },
      ],
      error: null,
      status: 200,
    })
    await expect(adapter.listGroupActivities('g1')).resolves.toEqual([
      {
        id: 'a1',
        groupId: 'g1',
        presetKey: 'gym',
        customName: null,
        createdBy: 'user-1',
        lockedScheduleType: 'times_per_week',
      },
      {
        id: 'a2',
        groupId: 'g1',
        presetKey: null,
        customName: 'Pottery',
        createdBy: 'user-2',
        lockedScheduleType: null,
      },
    ])
    expect(db.from).toHaveBeenCalledWith('group_activity_options')
    expect(db.query.eq).toHaveBeenCalledWith('group_id', 'g1')
  })

  it('a group activity with an unknown schedule type is an error; no response → network', async () => {
    db.query.eq.mockResolvedValueOnce({
      data: [
        {
          id: 'a1',
          group_id: 'g1',
          preset_key: 'gym',
          custom_name: null,
          created_by: 'user-1',
          locked_schedule_type: 'daily',
        },
      ],
      error: null,
      status: 200,
    })
    expect(await backendCodeOf(adapter.listGroupActivities('g1'))).toBe('unknown')
    db.query.eq.mockResolvedValueOnce({
      data: null,
      error: { message: 'TypeError: Failed to fetch', code: '', details: '', hint: '' },
      status: 0,
    })
    expect(await backendCodeOf(adapter.listGroupActivities('g1'))).toBe('network')
  })
})

describe('plan', () => {
  const PREVIEW_ROW = {
    member_today: '2026-11-18',
    week_start: '2026-11-16',
    week_end: '2026-11-22',
    starts_on: '2026-11-23',
    min_end_date: '2026-11-29',
    last_week_target: 2,
  }

  it('plan_preview sends only the inputs it has and maps the row', async () => {
    db.rpc.mockResolvedValueOnce({ data: [PREVIEW_ROW], error: null, status: 200 })
    expect(await adapter.planPreview('g1', 3, '2026-12-04')).toEqual({
      memberToday: '2026-11-18',
      weekStart: '2026-11-16',
      weekEnd: '2026-11-22',
      startsOn: '2026-11-23',
      minEndDate: '2026-11-29',
      lastWeekTarget: 2,
    })
    expect(db.rpc).toHaveBeenLastCalledWith('plan_preview', {
      p_group_id: 'g1',
      p_target: 3,
      p_end_date: '2026-12-04',
    })
    db.rpc.mockResolvedValueOnce({
      data: [{ ...PREVIEW_ROW, last_week_target: null }],
      error: null,
      status: 200,
    })
    expect((await adapter.planPreview('g1', null, null)).lastWeekTarget).toBeNull()
    expect(db.rpc).toHaveBeenLastCalledWith('plan_preview', { p_group_id: 'g1' })
  })

  it('plan_preview maps its error codes; no row is an error', async () => {
    db.rpc.mockResolvedValueOnce({ data: null, error: pgError('not_member'), status: 400 })
    expect(await backendCodeOf(adapter.planPreview('g1', null, null))).toBe('not_member')
    db.rpc.mockResolvedValueOnce({ data: [], error: null, status: 200 })
    expect(await backendCodeOf(adapter.planPreview('g1', null, null))).toBe('unknown')
  })

  it('add_commitment sends the activity and only the schedule fields of its type', async () => {
    db.rpc.mockResolvedValue({
      data: [{ commitment_id: 'c1', starts_on: '2026-11-23' }],
      error: null,
      status: 200,
    })
    expect(
      await adapter.addCommitment({
        groupId: 'g1',
        activity: { kind: 'preset', presetKey: 'gym' },
        scheduleType: 'times_per_week',
        days: null,
        target: 3,
        endDate: '2026-12-04',
      }),
    ).toEqual({ commitmentId: 'c1', startsOn: '2026-11-23' })
    expect(db.rpc).toHaveBeenLastCalledWith('add_commitment', {
      p_group_id: 'g1',
      p_preset_key: 'gym',
      p_schedule_type: 'times_per_week',
      p_target: 3,
      p_end_date: '2026-12-04',
    })
    await adapter.addCommitment({
      groupId: 'g1',
      activity: { kind: 'group', groupActivityId: 'ga-1' },
      scheduleType: 'fixed_days',
      days: [1, 3],
      target: null,
      endDate: null,
    })
    expect(db.rpc).toHaveBeenLastCalledWith('add_commitment', {
      p_group_id: 'g1',
      p_group_activity_id: 'ga-1',
      p_schedule_type: 'fixed_days',
      p_days: [1, 3],
    })
    await adapter.addCommitment({
      groupId: 'g1',
      activity: { kind: 'custom', name: 'Pottery' },
      scheduleType: 'fixed_days',
      days: [7],
      target: null,
      endDate: null,
    })
    expect(db.rpc).toHaveBeenLastCalledWith('add_commitment', {
      p_group_id: 'g1',
      p_custom_name: 'Pottery',
      p_schedule_type: 'fixed_days',
      p_days: [7],
    })
    db.rpc.mockReset()
  })

  it('add_commitment maps its error codes; no response → network', async () => {
    const input = {
      groupId: 'g1',
      activity: { kind: 'preset', presetKey: 'gym' } as const,
      scheduleType: 'fixed_days' as const,
      days: [1],
      target: null,
      endDate: null,
    }
    for (const code of [
      'not_member',
      'invalid_plan',
      'invalid_activity',
      'invalid_end_date',
      'schedule_type_locked',
    ]) {
      db.rpc.mockResolvedValueOnce({ data: null, error: pgError(code), status: 400 })
      expect(await backendCodeOf(adapter.addCommitment(input))).toBe(code)
    }
    db.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'TypeError: Failed to fetch', code: '', details: '', hint: '' },
      status: 0,
    })
    expect(await backendCodeOf(adapter.addCommitment(input))).toBe('network')
  })
})
