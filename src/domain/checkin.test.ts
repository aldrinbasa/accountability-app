import {
  captionCount,
  checkinAlt,
  checkinPhotoPath,
  isRetryablePostError,
  isWontCount,
  normalizeCaption,
  pickerStatus,
  postedAnnouncement,
  scaledSize,
  targetTitle,
  type CheckinTarget,
} from '@/domain/checkin'

const FIXED: CheckinTarget = {
  commitmentId: 'c1',
  kind: 'commitment',
  presetKey: 'gym',
  activityName: 'Gym',
  name: null,
  scheduleType: 'fixed_days',
  dueToday: true,
  // A Friday.
  memberToday: '2026-11-20',
  deadline: null,
  target: 3,
  doneCount: 1,
  wontCount: null,
}
const TIMES: CheckinTarget = { ...FIXED, commitmentId: 'c2', scheduleType: 'times_per_week' }
const TASK: CheckinTarget = {
  ...FIXED,
  commitmentId: 't1',
  kind: 'task',
  name: 'Grocery run',
  scheduleType: null,
  deadline: '2026-11-22',
  target: 1,
  doneCount: 0,
}

describe('pickerStatus', () => {
  it('shows the normal status when the post would count', () => {
    expect(pickerStatus(FIXED)).toBe('Fri · due')
    expect(pickerStatus({ ...TIMES, doneCount: 2 })).toBe('2/3 this week')
    expect(pickerStatus(TASK)).toBe('Task · by Sun')
  })

  it("replaces it with the won't-count note", () => {
    expect(pickerStatus({ ...FIXED, wontCount: 'not_today' })).toBe("not today · won't count")
    expect(pickerStatus({ ...TIMES, wontCount: 'counted_today' })).toBe(
      "counted today · won't count",
    )
    expect(pickerStatus({ ...TIMES, wontCount: 'target_met' })).toBe(
      "target met · won't add points",
    )
    expect(pickerStatus({ ...TASK, wontCount: 'done' })).toBe("done · won't count")
  })

  it('knows the reasons and titles', () => {
    expect(isWontCount('target_met')).toBe(true)
    expect(isWontCount('later')).toBe(false)
    expect(targetTitle(TASK)).toBe('Grocery run')
    expect(targetTitle(FIXED)).toBe('Gym')
  })
})

describe('caption', () => {
  it('counts live against 80', () => {
    expect(captionCount('')).toBe('0/80')
    expect(captionCount('leg day. send help.')).toBe('19/80')
    expect(captionCount('x'.repeat(80))).toBe('80/80')
  })

  it('is trimmed, and empty becomes null', () => {
    expect(normalizeCaption('  leg day  ')).toBe('leg day')
    expect(normalizeCaption('   ')).toBeNull()
    expect(normalizeCaption('')).toBeNull()
  })
})

describe('scaledSize', () => {
  it('scales the long edge down, keeping 4:3', () => {
    expect(scaledSize(1920, 1440, 1080)).toEqual({ width: 1080, height: 810 })
    expect(scaledSize(1920, 1440, 360)).toEqual({ width: 360, height: 270 })
    expect(scaledSize(1440, 1920, 360)).toEqual({ width: 270, height: 360 })
  })

  it('never upscales', () => {
    expect(scaledSize(640, 480, 1080)).toEqual({ width: 640, height: 480 })
    expect(scaledSize(1080, 810, 1080)).toEqual({ width: 1080, height: 810 })
  })

  it('an empty frame stays empty', () => {
    expect(scaledSize(0, 0, 1080)).toEqual({ width: 0, height: 0 })
  })
})

describe('posting copy and rules', () => {
  it('announces "Posted. Gym 4 of 5."', () => {
    expect(postedAnnouncement('Gym', 4, 5)).toBe('Posted. Gym 4 of 5.')
  })

  it('retries only network, unknown and photo_missing', () => {
    for (const code of ['network', 'unknown', 'photo_missing'] as const) {
      expect(isRetryablePostError(code)).toBe(true)
    }
    for (const code of [
      'week_locked',
      'commitment_ended',
      'not_member',
      'bad_capture_time',
      'checkin_conflict',
      'invalid_caption',
    ] as const) {
      expect(isRetryablePostError(code)).toBe(false)
    }
  })

  it('builds the object path and the alt text', () => {
    expect(checkinPhotoPath('g1', 'k1', 360)).toBe('g1/k1/360.webp')
    expect(checkinAlt('Gym', null)).toBe('Your Gym check-in')
    expect(checkinAlt('Gym', 'leg day')).toBe('Your Gym check-in, caption: leg day')
  })
})
