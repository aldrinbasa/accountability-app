import { expect, test } from './support/fixtures'
import { createFirstGroup, signUp, tab } from './support/members'

/**
 * Story 3.6 against Chromium's fake camera and the local Supabase stack: Me > Settings "Profile
 * photo" → Add a photo → the front camera in avatar mode (square frame, no target chip) → shutter →
 * the circle preview → Use photo uploads a 256 px WebP to the `avatars` bucket and sets
 * `avatar_path`; the row then reads "Change photo" and shows the photo through a signed URL.
 */
test('a profile photo from Settings: camera, Use photo, and the row shows it', async ({ page }) => {
  await signUp(page, { name: 'Pixie' })
  await createFirstGroup(page, 'Photo Crew')

  await tab(page, 'Me').click()
  await page.getByRole('link', { name: 'Settings' }).click()
  const row = page.locator('[data-component="profile-photo-row"]')
  await expect(row).toContainText('Profile photo')
  const url = page.url()

  const add = row.getByRole('button', { name: 'Add a photo' })
  await add.click()
  const camera = page.getByRole('dialog', { name: 'Camera' })
  await expect(camera).toHaveAttribute('data-mode', 'avatar')
  await expect(camera.locator('[data-component="target-chip"]')).toHaveCount(0)
  await expect(camera.locator('input[type=file]')).toHaveCount(0)
  const viewfinder = camera.locator('[data-component="viewfinder"]')
  const box = await viewfinder.boundingBox()
  expect(box).not.toBeNull()
  expect(Math.abs((box?.width ?? 0) - (box?.height ?? 1))).toBeLessThan(2)

  await camera.getByRole('button', { name: 'Take photo' }).click()
  await expect(camera.locator('[data-component="avatar-circle"]')).toBeVisible()
  await camera.getByRole('button', { name: 'Use photo' }).click()
  await expect(camera).toBeHidden()
  expect(page.url()).toBe(url)

  const change = row.getByRole('button', { name: 'Change photo' })
  await expect(change).toBeVisible()
  await expect(change).toBeFocused()
  const photo = row.locator('img')
  await expect(row.locator('[data-fill][data-photo]')).toHaveCount(1)
  expect(await photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(256)
  expect(await photo.getAttribute('src')).toMatch(/\/storage\/v1\/object\/sign\/avatars\//)
})
