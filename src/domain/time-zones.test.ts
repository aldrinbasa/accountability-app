import {
  chooseZone,
  filterZones,
  formatLockTime,
  formatSessionTime,
  pendingFromText,
  pickerZones,
  zoneCity,
  zoneLabel,
  zoneRegion,
  type TimeZoneState,
} from '@/domain/time-zones'

const ZONES = [
  'America/Argentina/Buenos_Aires',
  'America/New_York',
  'Asia/Manila',
  'Europe/London',
  'Pacific/Auckland',
]

describe('zone naming', () => {
  it('takes the city from the last part of the IANA name, underscores as spaces', () => {
    expect(zoneCity('America/New_York')).toBe('New York')
    expect(zoneCity('America/Argentina/Buenos_Aires')).toBe('Buenos Aires')
    expect(zoneCity('Europe/London')).toBe('London')
    expect(zoneCity('UTC')).toBe('UTC')
  })

  it('takes the region from the first part, none for a single-part name', () => {
    expect(zoneRegion('Europe/London')).toBe('Europe')
    expect(zoneRegion('America/Argentina/Buenos_Aires')).toBe('America')
    expect(zoneRegion('UTC')).toBeNull()
  })

  it('labels a picker row "City · Region"', () => {
    expect(zoneLabel('Europe/London')).toBe('London · Europe')
    expect(zoneLabel('America/New_York')).toBe('New York · America')
    expect(zoneLabel('UTC')).toBe('UTC')
  })

  it('names a pending change\'s start "from Mon 23 Nov"', () => {
    expect(pendingFromText('2026-11-23')).toBe('from Mon 23 Nov')
  })
})

describe('picker zones', () => {
  it('filters by IANA name or city, case-insensitive, spaces matching underscores', () => {
    expect(filterZones(ZONES, 'new york')).toEqual(['America/New_York'])
    expect(filterZones(ZONES, 'NEW_YORK')).toEqual(['America/New_York'])
    expect(filterZones(ZONES, 'buenos a')).toEqual(['America/Argentina/Buenos_Aires'])
    expect(filterZones(ZONES, 'europe')).toEqual(['Europe/London'])
    expect(filterZones(ZONES, 'america/')).toEqual([
      'America/Argentina/Buenos_Aires',
      'America/New_York',
    ])
    expect(filterZones(ZONES, '  lon ')).toEqual(['Europe/London'])
    expect(filterZones(ZONES, '')).toEqual(ZONES)
    expect(filterZones(ZONES, 'Mars')).toEqual([])
  })

  it('offers the runtime list plus the current and pending zones, sorted, without duplicates', () => {
    expect(pickerZones(['UTC', 'Europe/London'], () => ZONES)).toEqual([...ZONES, 'UTC'])
    expect(pickerZones(['Asia/Manila', null], () => ZONES)).toEqual(ZONES)
  })

  it('falls back to the given zones when the runtime has no list', () => {
    expect(pickerZones(['Asia/Manila', null], () => [])).toEqual(['Asia/Manila'])
    expect(
      pickerZones(['Asia/Manila'], () => {
        throw new TypeError('supportedValuesOf is not a function')
      }),
    ).toEqual(['Asia/Manila'])
  })

  it('uses Intl.supportedValuesOf by default, and only the given zones without it', () => {
    const intl = Intl as unknown as { supportedValuesOf?: unknown }
    const original = intl.supportedValuesOf
    try {
      intl.supportedValuesOf = () => ['Europe/London']
      expect(pickerZones(['Asia/Manila'])).toEqual(['Asia/Manila', 'Europe/London'])
      intl.supportedValuesOf = undefined
      expect(pickerZones(['Asia/Manila'])).toEqual(['Asia/Manila'])
    } finally {
      intl.supportedValuesOf = original
    }
  })
})

describe('chooseZone (optimistic)', () => {
  const state: TimeZoneState = {
    timeZone: 'Europe/London',
    pendingTimeZone: 'Asia/Tokyo',
    pendingWeekStart: '2026-11-23',
  }

  it('the current zone clears a waiting change', () => {
    expect(chooseZone(state, 'Europe/London')).toEqual({
      timeZone: 'Europe/London',
      pendingTimeZone: null,
      pendingWeekStart: null,
    })
  })

  it('another zone waits, keeping the known start Monday (none when not known yet)', () => {
    expect(chooseZone(state, 'America/New_York')).toEqual({
      ...state,
      pendingTimeZone: 'America/New_York',
    })
    expect(
      chooseZone({ ...state, pendingTimeZone: null, pendingWeekStart: null }, 'America/New_York'),
    ).toEqual({
      timeZone: 'Europe/London',
      pendingTimeZone: 'America/New_York',
      pendingWeekStart: null,
    })
  })
})

describe('time formatters', () => {
  it("formats a session time in the member's stored zone, whatever the device zone is", () => {
    const device = Intl.DateTimeFormat().resolvedOptions().timeZone
    const at = '2026-11-18T07:12:00Z'
    const expected: Record<string, string> = {
      'Europe/London': 'Wed 07:12',
      'Asia/Tokyo': 'Wed 16:12',
      'America/New_York': 'Wed 02:12',
      'Pacific/Auckland': 'Wed 20:12',
    }
    // At least two of these differ from the device's zone, so the device zone is never used.
    expect(Object.keys(expected).filter((zone) => zone !== device).length).toBeGreaterThan(1)
    for (const [zone, text] of Object.entries(expected)) {
      expect(formatSessionTime(at, zone)).toBe(text)
    }
  })

  it('shows a lock stored as Thursday 00:00 as "Wed 23:59" in the group zone', () => {
    expect(formatLockTime('2026-11-26T00:00:00Z', 'Europe/London', 'Europe/London')).toBe(
      'Wed 23:59',
    )
    expect(formatLockTime('2026-12-03T05:00:00Z', 'America/New_York', 'America/New_York')).toBe(
      'Wed 23:59',
    )
  })

  it("names the group zone's city when it differs from the member's", () => {
    expect(formatLockTime('2026-11-26T00:00:00Z', 'Europe/London', 'America/New_York')).toBe(
      'Wed 23:59 London time',
    )
    expect(formatLockTime('2026-12-03T05:00:00Z', 'America/New_York', 'Europe/London')).toBe(
      'Wed 23:59 New York time',
    )
  })

  it('keeps any other group-wide time as it is', () => {
    expect(formatLockTime('2026-11-25T18:30:00Z', 'Europe/London', 'Europe/London')).toBe(
      'Wed 18:30',
    )
  })
})
