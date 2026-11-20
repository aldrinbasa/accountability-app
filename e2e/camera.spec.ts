import { expect, test } from './support/fixtures'
import { createFirstGroup, signUp } from './support/members'

/**
 * Story 3.1 against Chromium's fake camera (playwright.config.ts launch flags, camera permission in
 * the phone profile): the overlay opens with no route change, goes live, closes on Esc with focus
 * back on the trigger, pre-picks a row's target, and the shutter hands the shot to the check-in
 * handler (the interim toast until Story 3.2).
 */
test('the camera opens over Today, goes live, closes, and takes a photo', async ({ page }) => {
  await signUp(page, { name: 'Cam' })
  await createFirstGroup(page, 'Shutter Club')

  // A task this week, so Today has a row with Check in.
  await page.getByRole('button', { name: 'Add a commitment or task' }).click()
  const sheet = page.getByRole('dialog', { name: 'Add a commitment or task' })
  await sheet.getByRole('radio', { name: 'Task' }).click()
  await sheet.getByRole('radio', { name: 'Groceries' }).click()
  await sheet.getByRole('textbox', { name: 'Name' }).fill('Grocery run')
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(sheet).toBeHidden()
  const rowCheckIn = page.getByRole('button', { name: 'Check in Grocery run' })
  await expect(rowCheckIn).toBeVisible()

  // Snap-first from the Camera button: no target chip, no URL or history change.
  const cameraButton = page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Check in', exact: true })
  const url = page.url()
  const historyLength = await page.evaluate(() => window.history.length)
  await cameraButton.click()
  const camera = page.getByRole('dialog', { name: 'Camera' })
  await expect(camera).toBeVisible()
  const shutter = camera.getByRole('button', { name: 'Take photo' })
  await expect(shutter).toBeVisible()
  await expect(shutter).toBeFocused()
  await expect(camera.locator('[data-component="target-chip"]')).toHaveCount(0)
  await expect(camera.locator('video[data-first-frame-ms]')).toHaveCount(1)
  await expect(camera.locator('input[type="file"]')).toHaveCount(0)
  expect(page.url()).toBe(url)
  expect(await page.evaluate(() => window.history.length)).toBe(historyLength)

  await page.keyboard.press('Escape')
  await expect(camera).toBeHidden()
  await expect(cameraButton).toBeFocused()
  expect(page.url()).toBe(url)

  // Pre-picked from the row, then the shutter.
  await rowCheckIn.click()
  await expect(camera).toBeVisible()
  await expect(camera.locator('[data-component="target-chip"]')).toHaveText('Grocery run')
  await camera.getByRole('button', { name: 'Take photo' }).click()
  await expect(camera).toBeHidden()
  await expect(page.getByText('Photo taken. Posting comes in the next update.')).toBeVisible()
  expect(page.url()).toBe(url)
})
