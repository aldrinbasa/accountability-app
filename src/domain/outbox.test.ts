import {
  backoffDelay,
  compareSendOrder,
  isTerminalPostError,
  OUTBOX_OLD_MS,
  rejectionBannerText,
  signOutWarning,
  toRejection,
  waitingBannerText,
  type OutboxItem,
} from '@/domain/outbox'
import { offlineBannerText } from '@/domain/offline'

const NOW = Date.parse('2026-11-20T09:00:00.000Z')

function item(overrides: Partial<OutboxItem> = {}): OutboxItem {
  return {
    id: 'k1',
    groupId: 'g1',
    groupName: 'Sunday Reset',
    commitmentId: 'c1',
    title: 'Gym',
    // 07:12 in London (GMT in November).
    capturedAt: '2026-11-20T07:12:00.000Z',
    caption: null,
    firstQueuedAt: NOW - 60_000,
    attempts: 0,
    rejection: null,
    ...overrides,
  }
}

describe('terminal codes', () => {
  it('rejects on the final codes and retries network, unknown and photo_missing', () => {
    for (const code of [
      'week_locked',
      'commitment_ended',
      'not_member',
      'session_frozen',
      'bad_capture_time',
      'checkin_conflict',
      'invalid_caption',
    ] as const) {
      expect(isTerminalPostError(code)).toBe(true)
    }
    for (const code of ['network', 'unknown', 'photo_missing'] as const) {
      expect(isTerminalPostError(code)).toBe(false)
    }
  })
})

describe('backoff', () => {
  it('starts at 5 s, doubles, and caps at 5 min', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 50].map(backoffDelay)).toEqual([
      5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000, 300_000,
    ])
  })
})

describe('send order', () => {
  it('oldest first, then by id', () => {
    const items = [
      item({ id: 'c', firstQueuedAt: 3 }),
      item({ id: 'b', firstQueuedAt: 1 }),
      item({ id: 'a', firstQueuedAt: 3 }),
    ]
    expect([...items].sort(compareSendOrder).map((i) => i.id)).toEqual(['b', 'a', 'c'])
  })
})

describe('waiting banner', () => {
  it('one photo: title, group and capture time in the member zone', () => {
    expect(waitingBannerText([item()], NOW, 'Europe/London')).toBe(
      "1 photo waiting to send · Gym · Sunday Reset · taken 07:12. Sends when you're back online.",
    )
    expect(waitingBannerText([item()], NOW, 'Asia/Manila')).toContain('taken 15:12.')
  })

  it("several: the count and the oldest's details", () => {
    const newer = item({ id: 'k2', title: 'Run', groupName: 'Crew', firstQueuedAt: NOW - 1_000 })
    const older = item({ id: 'k1', firstQueuedAt: NOW - 120_000 })
    expect(waitingBannerText([newer, older], NOW, 'Europe/London')).toBe(
      "2 photos waiting to send · Gym · Sunday Reset · taken 07:12. Sends when you're back online.",
    )
  })

  it('adds "Couldn\'t send yet." from 3 failed attempts on any entry', () => {
    expect(waitingBannerText([item({ attempts: 2 })], NOW, 'UTC')).not.toContain("Couldn't send")
    expect(waitingBannerText([item(), item({ id: 'k2', attempts: 3 })], NOW, 'UTC')).toMatch(
      /Sends when you're back online\. Couldn't send yet\.$/,
    )
  })

  it('adds the 5-day warning once the oldest has waited 5 days', () => {
    const almost = item({ firstQueuedAt: NOW - OUTBOX_OLD_MS + 1 })
    const old = item({ firstQueuedAt: NOW - OUTBOX_OLD_MS, attempts: 4 })
    expect(waitingBannerText([almost], NOW, 'UTC')).not.toContain('Open Proofy')
    expect(waitingBannerText([old], NOW, 'UTC')).toMatch(
      /Couldn't send yet\. Open Proofy now and then so your phone doesn't clear it\.$/,
    )
  })

  it('leaves the group out when its name is not known', () => {
    expect(waitingBannerText([item({ groupName: '' })], NOW, 'Europe/London')).toBe(
      "1 photo waiting to send · Gym · taken 07:12. Sends when you're back online.",
    )
  })

  it('nothing waiting: no banner', () => {
    expect(waitingBannerText([], NOW, 'UTC')).toBeNull()
  })
})

describe('rejection banner', () => {
  it('week_locked: the lock time in the group zone, the city named when it differs', () => {
    const rejection = toRejection(
      'week_locked',
      '{"lock_at" : "2026-11-26T00:00:00+00:00", "time_zone" : "Europe/London"}',
    )
    expect(rejection).toEqual({
      code: 'week_locked',
      lockAt: '2026-11-26T00:00:00+00:00',
      timeZone: 'Europe/London',
    })
    expect(rejectionBannerText('Gym', rejection, 'Europe/London')).toBe(
      "Too late for last week. It locked Wed 23:59, so this photo can't count.",
    )
    expect(rejectionBannerText('Gym', rejection, 'Asia/Manila')).toBe(
      "Too late for last week. It locked Wed 23:59 London time, so this photo can't count.",
    )
  })

  it('week_locked without readable details falls back', () => {
    for (const detail of [
      null,
      '',
      'nope',
      '{"lock_at":"x","time_zone":"UTC"}',
      '{"lock_at":"2026-11-26T00:00:00Z","time_zone":"Mars/Base"}',
    ]) {
      const rejection = toRejection('week_locked', detail)
      expect(rejection.lockAt).toBeNull()
      expect(rejectionBannerText('Gym', rejection, 'UTC')).toBe(
        "Too late for last week. That week has locked, so this photo can't count.",
      )
    }
  })

  it('other codes: "Couldn\'t post your {title} photo: {reason}."', () => {
    const line = (code: Parameters<typeof toRejection>[0]) =>
      rejectionBannerText('Gym', toRejection(code, null), 'UTC')
    expect(line('commitment_ended')).toBe("Couldn't post your Gym photo: commitment ended.")
    expect(line('not_member')).toBe("Couldn't post your Gym photo: removed from the group.")
    expect(line('session_frozen')).toBe("Couldn't post your Gym photo: session already frozen.")
    expect(line('bad_capture_time')).toBe(
      "Couldn't post your Gym photo: your phone's clock was ahead.",
    )
    expect(line('checkin_conflict')).toBe("Couldn't post your Gym photo: it was already posted.")
    expect(line('invalid_caption')).toBe("Couldn't post your Gym photo: the caption was too long.")
  })
})

describe('sign-out and offline copy', () => {
  it('warns about the waiting photos', () => {
    expect(signOutWarning(1)).toBe('1 photo is still waiting to send. Signing out deletes it.')
    expect(signOutWarning(3)).toBe('3 photos are still waiting to send. Signing out deletes them.')
  })

  it('the offline banner shows the last fetch in the given zone', () => {
    expect(offlineBannerText(Date.parse('2026-11-20T07:40:00Z'), 'Europe/London')).toBe(
      'Offline · showing what you had at 07:40.',
    )
  })
})
