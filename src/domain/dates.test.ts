import { DAY_LONG, DAY_SHORT, MONTH_SHORT, parseIsoDate } from '@/domain/dates'

describe('dates', () => {
  it('parseIsoDate reads YYYY-MM-DD as that calendar day at UTC midnight', () => {
    const date = parseIsoDate('2026-11-16')
    expect(date?.toISOString()).toBe('2026-11-16T00:00:00.000Z')
    expect(date?.getUTCDay()).toBe(1)
  })

  it('parseIsoDate returns null for anything not in YYYY-MM-DD form', () => {
    expect(parseIsoDate('')).toBeNull()
    expect(parseIsoDate('2026-11-16T00:00:00Z')).toBeNull()
    expect(parseIsoDate('16 Nov 2026')).toBeNull()
    expect(parseIsoDate('2026-1-6')).toBeNull()
  })

  it('the day tables start on Sunday, as getUTCDay counts', () => {
    expect(DAY_SHORT).toHaveLength(7)
    expect(DAY_LONG).toHaveLength(7)
    expect(DAY_SHORT[0]).toBe('Sun')
    expect(DAY_LONG[0]).toBe('Sunday')
    expect(DAY_SHORT[1]).toBe('Mon')
    expect(DAY_LONG[6]).toBe('Saturday')
  })

  it('the month table starts on January, as getUTCMonth counts', () => {
    expect(MONTH_SHORT).toHaveLength(12)
    expect(MONTH_SHORT[0]).toBe('Jan')
    expect(MONTH_SHORT[10]).toBe('Nov')
  })
})
