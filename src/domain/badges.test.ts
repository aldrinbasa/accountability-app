import {
  allTimePointsText,
  badgeLabel,
  earnedText,
  formatPoints,
  leftMemberText,
  pendingText,
  sealFill,
  titleName,
  titleRungText,
  type ProfileBadge,
} from '@/domain/badges'

const BADGE: ProfileBadge = {
  key: 'first_proof',
  name: 'First Proof',
  howEarned: 'Your first check-in',
  line: "Pics or it didn't happen. It happened.",
  icon: 'camera',
  status: 'locked',
  awardedAt: null,
  pendingLockAt: null,
}

describe('badge status labels (Story 4.6)', () => {
  it('earned names the day in the viewer zone; pending and locked say so', () => {
    expect(
      badgeLabel({ ...BADGE, status: 'earned', awardedAt: '2026-11-12T00:00:01Z' }, 'UTC'),
    ).toBe('First Proof, earned 12 Nov')
    // 23:30 UTC on 11 Nov is already 12 Nov in Manila.
    expect(
      badgeLabel({ ...BADGE, status: 'earned', awardedAt: '2026-11-11T23:30:00Z' }, 'Asia/Manila'),
    ).toBe('First Proof, earned 12 Nov')
    expect(badgeLabel({ ...BADGE, status: 'pending' }, 'UTC')).toBe('First Proof, pending')
    expect(badgeLabel(BADGE, 'UTC')).toBe('First Proof, locked')
  })

  it('an earned badge without a date reads as locked rather than inventing one', () => {
    expect(badgeLabel({ ...BADGE, status: 'earned' }, 'UTC')).toBe('First Proof, locked')
  })

  it('earned and pending lines for the badge Sheet', () => {
    expect(earnedText('2026-11-19T00:00:01Z', 'UTC')).toBe('Earned 19 Nov')
    // Thursday 00:00 group time reads as Wed 23:59; the zone is named when it differs.
    expect(pendingText('2026-11-25T16:00:00Z', 'Asia/Manila', 'Asia/Manila')).toBe(
      'Unlocks when the week locks, Wed 23:59.',
    )
    expect(pendingText('2026-11-25T16:00:00Z', 'Asia/Manila', 'Europe/Paris')).toBe(
      'Unlocks when the week locks, Wed 23:59 Manila time.',
    )
  })

  it('seal fills rotate vote, sticky, sticky2 in catalog order', () => {
    expect([0, 1, 2, 3, 14].map(sealFill)).toEqual(['vote', 'sticky', 'sticky2', 'vote', 'sticky2'])
  })
})

describe('all-time points formatting (Story 4.6)', () => {
  it('uses thousands separators', () => {
    expect(formatPoints(0)).toBe('0')
    expect(formatPoints(999)).toBe('999')
    expect(formatPoints(1284)).toBe('1,284')
    expect(formatPoints(10000)).toBe('10,000')
  })

  it('"{n} all-time points in {Group}", singular for 1', () => {
    expect(allTimePointsText(1284, 'Sunday Reset')).toBe('1,284 all-time points in Sunday Reset')
    expect(allTimePointsText(0, 'Crew')).toBe('0 all-time points in Crew')
    expect(allTimePointsText(1, 'Crew')).toBe('1 all-time point in Crew')
  })
})

describe('titles and member states (Story 4.6)', () => {
  const titles = [
    { key: 'couch_potato', name: 'Couch Potato', minPoints: 0 },
    { key: 'legend', name: 'Legend', minPoints: 10000 },
  ]

  it('names a title by key, "" while unknown', () => {
    expect(titleName(titles, 'legend')).toBe('Legend')
    expect(titleName(titles, 'nope')).toBe('')
    expect(titleName(undefined, 'legend')).toBe('')
  })

  it('ladder rungs show the threshold with separators', () => {
    expect(titleRungText(titles[1]!)).toBe('Legend · 10,000 points')
  })

  it('a member who left', () => {
    expect(leftMemberText('Sam')).toBe("Sam isn't in this group anymore.")
  })
})
