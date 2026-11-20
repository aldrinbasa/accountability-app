import {
  AVATAR_EDGE,
  avatarObjectPath,
  avatarPhotoLabel,
  DISPLAY_NAME_MAX,
  prefillName,
  validateDisplayName,
} from '@/domain/profile'

describe('avatars', () => {
  it('a 256 px square at {user_id}/{version}.webp, lowercase', () => {
    expect(AVATAR_EDGE).toBe(256)
    expect(avatarObjectPath('AB-1', 'CD-2')).toBe('ab-1/cd-2.webp')
  })

  it('labels the photo with the name', () => {
    expect(avatarPhotoLabel('Jo')).toBe("Jo's photo")
  })
})

describe('validateDisplayName', () => {
  it.each(['Jo', '  Jo  ', 'a'.repeat(DISPLAY_NAME_MAX), ` ${'a'.repeat(24)} `, '😀'.repeat(24)])(
    'accepts %j',
    (name) => {
      expect(validateDisplayName(name)).toBeNull()
    },
  )

  it.each(['', '   ', '\t\n', 'a'.repeat(25), '😀'.repeat(25)])('rejects %j', (name) => {
    expect(validateDisplayName(name)).toBe('invalid_display_name')
  })
})

describe('prefillName', () => {
  it('cuts a long given name to the first 24 characters', () => {
    expect(prefillName('Josephine Annabelle Cruz-Santos')).toBe('Josephine Annabelle Cruz')
  })

  it('trims, and gives an empty string for nothing', () => {
    expect(prefillName('  Jo ')).toBe('Jo')
    expect(prefillName(undefined)).toBe('')
    expect(prefillName(null)).toBe('')
    expect(prefillName('')).toBe('')
  })

  it('never ends on a space after the cut', () => {
    expect(prefillName('Josephine Annabelle Cruz Santos')).toBe('Josephine Annabelle Cruz')
    expect(prefillName('abcdefghijklmnopqrstuvw xyz')).toBe('abcdefghijklmnopqrstuvw')
  })
})
