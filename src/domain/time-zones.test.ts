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

  it('puts the current zone outside the 24 first, marked (current), once', () => {
    const options = pickerOptions('Asia/Kolkata', 'Asia/Kolkata')
    expect(options).toHaveLength(25)
    expect(options[0]).toMatchObject({ zone: 'Asia/Kolkata', label: 'Kolkata · Asia (current)' })
    expect(options[1].label).toBe('GMT−11 · Pago Pago, Midway')
    expect(options[24].label).toBe('GMT+12 · Auckland, Wellington')
    expect(pickerOptions('Asia/Manila')).toHaveLength(24)
    expect(pickerOptions('Asia/Manila', 'Asia/Tokyo')).toHaveLength(24)
  })

  it('marks a waiting zone outside the 24 (waiting), not (current) (retro F3)', () => {
    expect(pickerOptions('Asia/Manila', 'Asia/Kolkata')[0]).toMatchObject({
      zone: 'Asia/Kolkata',
      label: 'Kolkata · Asia (waiting)',
    })
    const both = pickerOptions('Asia/Kolkata', 'Australia/Adelaide')
    expect(both).toHaveLength(26)
    expect(both.slice(0, 2).map((o) => o.label)).toEqual([
      'Kolkata · Asia (current)',
      'Adelaide · Australia (waiting)',
    ])
  })

  it('filters by offset exactly, or by city, case- and accent-insensitive', () => {
    const options = pickerOptions('Asia/Kolkata')
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

/** Each sample city's own IANA zone (retro F2): a city added to `ZONE_CHOICES` must be listed here. */
const CITY_ZONES: Record<string, string> = {
  'Pago Pago': 'Pacific/Pago_Pago',
  Midway: 'Pacific/Midway',
  Honolulu: 'Pacific/Honolulu',
  Tahiti: 'Pacific/Tahiti',
  Rarotonga: 'Pacific/Rarotonga',
  Anchorage: 'America/Anchorage',
  Juneau: 'America/Juneau',
  'Los Angeles': 'America/Los_Angeles',
  Vancouver: 'America/Vancouver',
  Seattle: 'America/Los_Angeles',
  Denver: 'America/Denver',
  Calgary: 'America/Edmonton',
  Edmonton: 'America/Edmonton',
  Chicago: 'America/Chicago',
  Houston: 'America/Chicago',
  Winnipeg: 'America/Winnipeg',
  'New York': 'America/New_York',
  Toronto: 'America/Toronto',
  Halifax: 'America/Halifax',
  Bermuda: 'Atlantic/Bermuda',
  'São Paulo': 'America/Sao_Paulo',
  'Buenos Aires': 'America/Argentina/Buenos_Aires',
  Montevideo: 'America/Montevideo',
  'South Georgia': 'Atlantic/South_Georgia',
  'Fernando de Noronha': 'America/Noronha',
  Azores: 'Atlantic/Azores',
  'Ponta Delgada': 'Atlantic/Azores',
  London: 'Europe/London',
  Lisbon: 'Europe/Lisbon',
  Paris: 'Europe/Paris',
  Berlin: 'Europe/Berlin',
  Rome: 'Europe/Rome',
  Athens: 'Europe/Athens',
  Helsinki: 'Europe/Helsinki',
  Kyiv: 'Europe/Kyiv',
  Moscow: 'Europe/Moscow',
  Istanbul: 'Europe/Istanbul',
  Nairobi: 'Africa/Nairobi',
  Dubai: 'Asia/Dubai',
  Baku: 'Asia/Baku',
  Karachi: 'Asia/Karachi',
  Tashkent: 'Asia/Tashkent',
  Dhaka: 'Asia/Dhaka',
  Bishkek: 'Asia/Bishkek',
  Bangkok: 'Asia/Bangkok',
  Jakarta: 'Asia/Jakarta',
  'Ho Chi Minh City': 'Asia/Ho_Chi_Minh',
  Manila: 'Asia/Manila',
  Singapore: 'Asia/Singapore',
  'Hong Kong': 'Asia/Hong_Kong',
  Tokyo: 'Asia/Tokyo',
  Seoul: 'Asia/Seoul',
  Sydney: 'Australia/Sydney',
  Melbourne: 'Australia/Melbourne',
  Canberra: 'Australia/Sydney',
  Nouméa: 'Pacific/Noumea',
  'Solomon Islands': 'Pacific/Guadalcanal',
  Auckland: 'Pacific/Auckland',
  Wellington: 'Pacific/Auckland',
}

const offsetFormats = new Map<string, Intl.DateTimeFormat>()

/** Minutes east of GMT in `zone` at `at`, through the runtime's IANA data. */
function offsetMinutes(zone: string, at: number): number {
  let format = offsetFormats.get(zone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
    offsetFormats.set(zone, format)
  }
  const name = format.formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? ''
  const match = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(name)
  if (!match) throw new Error(`unexpected offset name ${name} for ${zone}`)
  if (!match[1]) return 0
  return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
}

/** Every 6 hours through 2026 and 2027, so each daylight-saving switch on either side is covered. */
const SAMPLE_TIMES = Array.from(
  { length: 2 * 365 * 4 },
  (_, i) => Date.UTC(2026, 0, 1) + i * 6 * 3_600_000,
)

describe('picker sample cities (retro F2)', () => {
  it.each(ZONE_CHOICES.map((c) => [choiceLabel(c), c] as const))(
    '%s: every city shares the saved zone offset all year, standard offset as labelled',
    (_label, choice) => {
      const saved = SAMPLE_TIMES.map((at) => offsetMinutes(choice.zone, at))
      expect(Math.min(...saved)).toBe(choice.offset * 60)
      expect(choice.cities.length).toBeGreaterThanOrEqual(2)
      expect(choice.cities.length).toBeLessThanOrEqual(3)
      for (const city of choice.cities) {
        const zone = CITY_ZONES[city]
        expect(zone, `${city} needs an entry in CITY_ZONES`).toBeDefined()
        const mismatches = SAMPLE_TIMES.filter((at, i) => offsetMinutes(zone, at) !== saved[i]).map(
          (at) => new Date(at).toISOString(),
        )
        expect(mismatches, `${city} (${zone}) vs ${choice.zone}`).toEqual([])
      }
    },
  )

  it('catches a city on different rules (Phoenix is not Denver, Brisbane is not Sydney)', () => {
    const differs = (a: string, b: string) =>
      SAMPLE_TIMES.some((at) => offsetMinutes(a, at) !== offsetMinutes(b, at))
    expect(differs('America/Phoenix', 'America/Denver')).toBe(true)
    expect(differs('Australia/Brisbane', 'Australia/Sydney')).toBe(true)
    expect(differs('Africa/Cairo', 'Europe/Athens')).toBe(true)
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
