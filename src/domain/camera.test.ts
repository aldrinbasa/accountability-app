import {
  AVATAR_ASPECT,
  cameraAspect,
  cameraFacing,
  cameraPlatform,
  centerCrop,
  checkInLabel,
  fixItSteps,
  PHOTO_ASPECT,
} from '@/domain/camera'

describe('camera modes', () => {
  it('check-ins are 4:3 on the back camera, avatars square on the front one', () => {
    expect(cameraAspect('checkin')).toBe(PHOTO_ASPECT)
    expect(cameraAspect('avatar')).toBe(1)
    expect(cameraFacing('checkin')).toBe('environment')
    expect(cameraFacing('avatar')).toBe('user')
  })

  it('a square crop takes the middle of a portrait or landscape frame', () => {
    expect(centerCrop(720, 1280, AVATAR_ASPECT)).toEqual({ sx: 0, sy: 280, sw: 720, sh: 720 })
    expect(centerCrop(1920, 1080, AVATAR_ASPECT)).toEqual({ sx: 420, sy: 0, sw: 1080, sh: 1080 })
  })
})

describe('centerCrop', () => {
  it('keeps a 4:3 frame whole', () => {
    expect(centerCrop(1440, 1080, PHOTO_ASPECT)).toEqual({ sx: 0, sy: 0, sw: 1440, sh: 1080 })
  })

  it('takes the middle of a wider frame (16:9 loses its sides)', () => {
    expect(centerCrop(1920, 1080, PHOTO_ASPECT)).toEqual({ sx: 240, sy: 0, sw: 1440, sh: 1080 })
  })

  it('takes a landscape 4:3 slice from the middle of a portrait frame', () => {
    expect(centerCrop(1080, 1440, PHOTO_ASPECT)).toEqual({ sx: 0, sy: 315, sw: 1080, sh: 810 })
  })

  it('gives an empty rect for a frame with no size yet', () => {
    expect(centerCrop(0, 0, PHOTO_ASPECT)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 })
  })
})

describe('cameraPlatform and fixItSteps', () => {
  it('detects iOS, Android and everything else', () => {
    expect(
      cameraPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15'),
    ).toBe('ios')
    expect(cameraPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36')).toBe(
      'android',
    )
    expect(cameraPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('other')
  })

  it('names the Settings path on iOS and the lock icon or App info on Android', () => {
    expect(fixItSteps('ios').join(' ')).toMatch(/Settings.*Proofy.*Safari.*Camera.*Allow/)
    expect(fixItSteps('android').join(' ')).toMatch(
      /lock icon.*App info.*Permissions.*Camera.*Allow/,
    )
    expect(fixItSteps('other').length).toBeGreaterThan(0)
  })
})

it('labels a row Check in button with its title', () => {
  expect(checkInLabel('Grocery run')).toBe('Check in Grocery run')
})
