import {
  chooseZone,
  choiceLabel,
  displayZone,
  filterOptions,
  formatClock,
  formatLockTime,
  formatSessionTime,
  offsetLabel,
  pendingFromText,
  pickerOptions,
  ZONE_CHOICES,
  zoneCity,
  zoneLabel,
  zoneRegion,
  type TimeZoneState,
} from '@/domain/time-zones'

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

describe('picker choices', () => {
  it('has 24 choices, GMT−11 to GMT+12 in order, each saving one zone', () => {
    expect(ZONE_CHOICES).toHaveLength(24)
    expect(ZONE_CHOICES.map((c) => c.offset)).toEqual(Array.from({ length: 24 }, (_, i) => i - 11))
    expect(new Set(ZONE_CHOICES.map((c) => c.zone)).size).toBe(24)
  })

  it('labels a choice with its standard offset (a real minus sign) and sample cities', () => {
    expect(offsetLabel(8)).toBe('GMT+8')
    expect(offsetLabel(0)).toBe('GMT+0')
    expect(offsetLabel(-11)).toBe('GMT−11')
    const manila = ZONE_CHOICES.find((c) => c.zone === 'Asia/Manila')
    expect(manila && choiceLabel(manila)).toBe('GMT+8 · Manila, Singapore, Hong Kong')
  })

  it('shows one of the 24 by its label, any other zone as "City · Region"', () => {
    expect(displayZone('Europe/London')).toBe('GMT+0 · London, Lisbon')
    expect(displayZone('America/New_York')).toBe('GMT−5 · New York, Toronto')
    expect(displayZone('Asia/Kolkata')).toBe('Kolkata · Asia')
    expect(displayZone('UTC')).toBe('UTC')
  })

  it('puts a current or waiting zone outside the 24 first, marked (current), once', () => {
    const options = pickerOptions(['Asia/Kolkata', 'Asia/Kolkata', 'Asia/Manila', null])
    expect(options).toHaveLength(25)
    expect(options[0]).toMatchObject({ zone: 'Asia/Kolkata', label: 'Kolkata · Asia (current)' })
    expect(options[1].label).toBe('GMT−11 · Pago Pago, Midway')
    expect(options[24].label).toBe('GMT+12 · Auckland, Fiji')
    expect(pickerOptions(['Asia/Manila'])).toHaveLength(24)
  })

  it('filters by offset exactly, or by city, case- and accent-insensitive', () => {
    const options = pickerOptions(['Asia/Kolkata'])
    const zones = (query: string) => filterOptions(options, query).map((o) => o.zone)
    expect(zones('GMT+8')).toEqual(['Asia/Manila'])
    expect(zones('+8')).toEqual(['Asia/Manila'])
    expect(zones('+1')).toEqual(['Europe/Paris'])
    expect(zones('gmt-3')).toEqual(['America/Sao_Paulo'])
    expect(zones('GMT−3')).toEqual(['America/Sao_Paulo'])
    expect(zones('sao paulo')).toEqual(['America/Sao_Paulo'])
    expect(zones('NOUMEA')).toEqual(['Pacific/Noumea'])
    expect(zones('hong')).toEqual(['Asia/Manila'])
    expect(zones('kolkata')).toEqual(['Asia/Kolkata'])
    expect(zones('  ')).toHaveLength(25)
    expect(zones('Mars')).toEqual([])
  })
})

describe('formatClock', () => {
  it('shows the local time now through the real zone rules (live DST)', () => {
    const july = new Date('2026-07-15T13:32:00Z')
    const january = new Date('2026-01-15T13:32:00Z')
    expect(formatClock(july, 'Europe/London')).toBe('14:32')
    expect(formatClock(january, 'Europe/London')).toBe('13:32')
    expect(formatClock(july, 'Asia/Manila')).toBe('21:32')
    expect(formatClock(january, 'Asia/Manila')).toBe('21:32')
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
