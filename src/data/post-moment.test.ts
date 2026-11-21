import type { TodayData, TodayItem } from '@/domain/today'
import {
  clearPostMoment,
  getPostMoment,
  markPostMomentAnnounced,
  markPassedShown,
  markPostMomentPlayed,
  markStreakPopped,
  nextTodayMountId,
  optimisticScore,
  passedForMount,
  setPostMoment,
  streakPopFor,
  withPostMoment,
  type PostMoment,
} from '@/data/post-moment'

const ROW: TodayItem = {
  commitmentId: 'c1',
  kind: 'commitment',
  section: 'due_today',
  presetKey: 'gym',
  customName: null,
  activityName: 'Gym',
  name: null,
  scheduleType: 'times_per_week',
  days: null,
  target: 3,
  counted: 1,
  deadline: null,
  startsOn: null,
  canDelete: false,
  countedToday: false,
  targetMet: false,
}

const DATA: TodayData = {
  items: [ROW, { ...ROW, commitmentId: 'c2' }],
  summary: {
    memberToday: '2026-11-20',
    weekStart: '2026-11-16',
    weekNumber: 1,
    planned: 6,
    done: 1,
    left: 5,
    hasPlan: true,
  },
}

const MOMENT: PostMoment = {
  checkinId: 'k1',
  groupId: 'g1',
  commitmentId: 'c1',
  title: 'Gym',
  doneCount: 3,
  target: 3,
  counted: true,
  isLate: false,
  weeklyPoints: null,
  rank: null,
  passedUserIds: [],
  passedShownIn: null,
  streakBefore: null,
  streakPopped: false,
  photoUrl: null,
  caption: null,
  postedAt: 1000,
  played: false,
  announced: false,
}

describe('withPostMoment', () => {
  it("puts the post's counts on its row while the data is older than the post", () => {
    const next = withPostMoment(DATA, MOMENT, 999)
    expect(next.items[0]).toMatchObject({ counted: 3, countedToday: true, targetMet: true })
    expect(next.items[1]).toBe(DATA.items[1])
  })

  it('drops the override once Today was fetched after the post', () => {
    expect(withPostMoment(DATA, MOMENT, 1001)).toBe(DATA)
  })

  it('leaves the row to the refetch for a late post (it may have counted on another day)', () => {
    expect(withPostMoment(DATA, { ...MOMENT, isLate: true }, 999)).toBe(DATA)
  })

  it('changes nothing for an extra, no moment or a row that is gone', () => {
    expect(withPostMoment(DATA, { ...MOMENT, counted: false }, 0)).toBe(DATA)
    expect(withPostMoment(DATA, null, 0)).toBe(DATA)
    expect(withPostMoment(DATA, { ...MOMENT, commitmentId: 'gone' }, 0)).toBe(DATA)
  })
})

describe('post moment store', () => {
  it('marks played and announced once per post, and clears on sign-out', () => {
    setPostMoment(MOMENT)
    markPostMomentPlayed('other')
    expect(getPostMoment()?.played).toBe(false)
    markPostMomentPlayed('k1')
    markPostMomentAnnounced('k1')
    expect(getPostMoment()).toMatchObject({ played: true, announced: true })
    clearPostMoment()
    expect(getPostMoment()).toBeNull()
  })
})

describe('score after a post (Story 4.1)', () => {
  const SCORED: PostMoment = { ...MOMENT, weeklyPoints: 67, rank: 1, passedUserIds: ['u2'] }

  it('optimisticScore holds the post values until a board fetched after the post', () => {
    expect(optimisticScore(SCORED, 999)).toEqual({ weeklyPoints: 67, rank: 1 })
    expect(optimisticScore(SCORED, 1000)).toEqual({ weeklyPoints: 67, rank: 1 })
    expect(optimisticScore(SCORED, 1001)).toBeNull()
    expect(optimisticScore(null, 0)).toBeNull()
  })

  it('the passed list lasts until the next open of Today', () => {
    const first = nextTodayMountId()
    const second = nextTodayMountId()
    expect(second).toBeGreaterThan(first)
    expect(passedForMount(SCORED, first)).toEqual(['u2'])
    setPostMoment(SCORED)
    markPassedShown('k1', first)
    markPassedShown('k1', second)
    expect(getPostMoment()?.passedShownIn).toBe(first)
    expect(passedForMount(getPostMoment(), first)).toEqual(['u2'])
    expect(passedForMount(getPostMoment(), second)).toEqual([])
    expect(passedForMount({ ...SCORED, passedUserIds: [] }, first)).toEqual([])
    clearPostMoment()
  })
})

describe('streak milestone after a post (Story 4.2)', () => {
  const AT_TWO: PostMoment = { ...MOMENT, streakBefore: 2 }

  it('pops once streaks fetched after the post show exactly 1 more, at 3, 10 or 25', () => {
    expect(streakPopFor(AT_TWO, 3, 1001)).toBe(true)
    expect(streakPopFor({ ...MOMENT, streakBefore: 9 }, 10, 1001)).toBe(true)
    expect(streakPopFor({ ...MOMENT, streakBefore: 24 }, 25, 1001)).toBe(true)
  })

  it('does not pop on stale data, other values, a jump, an extra or an unknown start', () => {
    expect(streakPopFor(AT_TWO, 3, 1000)).toBe(false)
    expect(streakPopFor(AT_TWO, 2, 1001)).toBe(false)
    expect(streakPopFor({ ...MOMENT, streakBefore: 3 }, 4, 1001)).toBe(false)
    expect(streakPopFor({ ...MOMENT, streakBefore: 1 }, 3, 1001)).toBe(false)
    expect(streakPopFor({ ...AT_TWO, counted: false }, 3, 1001)).toBe(false)
    expect(streakPopFor(MOMENT, 3, 1001)).toBe(false)
    expect(streakPopFor(AT_TWO, null, 1001)).toBe(false)
    expect(streakPopFor(null, 3, 1001)).toBe(false)
  })

  it('plays once per post', () => {
    setPostMoment(AT_TWO)
    markStreakPopped('other')
    expect(getPostMoment()?.streakPopped).toBe(false)
    markStreakPopped('k1')
    expect(getPostMoment()?.streakPopped).toBe(true)
    expect(streakPopFor(getPostMoment(), 3, 1001)).toBe(false)
    clearPostMoment()
  })
})
