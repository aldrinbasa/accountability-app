import { expect, test } from './support/fixtures'
import { createFirstGroup, signUp } from './support/members'

/**
 * Story 3.2 against the local stack and Chromium's fake camera: a task due today is checked in from
 * its row (shutter, caption, Post: both WebP renditions go to the private bucket, then
 * `post_checkin`), Today shows the post moment's polaroid and the row turns Done; the snap-first
 * picker then lists the task with its won't-count note.
 */
test('check in a task from its row, then see it in the snap-first picker', async ({ page }) => {
  await signUp(page, { name: 'Poster' })
  await createFirstGroup(page, 'Proof Club')

  // A task due today.
  await page.getByRole('button', { name: 'Add a habit or task' }).click()
  const sheet = page.getByRole('dialog', { name: 'Add a habit or task' })
  await sheet.getByRole('radio', { name: 'Task' }).click()
  await sheet.getByRole('radio', { name: 'Groceries' }).click()
  await sheet.getByRole('textbox', { name: 'Name' }).fill('Grocery run')
  await sheet.getByRole('radio', { name: 'Today' }).click()
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(sheet).toBeHidden()

  // Pre-picked: the row's Check in, the shutter, a caption, Post.
  await page.getByRole('button', { name: 'Check in Grocery run' }).click()
  const camera = page.getByRole('dialog', { name: 'Camera' })
  await camera.getByRole('button', { name: 'Take photo' }).click()
  const caption = camera.getByRole('textbox', { name: 'Caption' })
  await caption.fill('milk, eggs, done')
  await expect(camera.getByText('16/80')).toBeVisible()
  await expect(camera.getByRole('figure').getByText('milk, eggs, done')).toBeVisible()
  await camera.getByRole('button', { name: 'Post' }).click()
  await expect(camera).toBeHidden({ timeout: 30_000 })

  // The post moment settles into Friends today as the first mini, and the server's Done row.
  const moment = page.locator('[data-component="post-moment"]')
  await expect(moment).toHaveText('You · Grocery run')
  await expect(moment).toHaveAccessibleName(/^Your Grocery run check-in.*milk, eggs, done$/)
  await expect(
    page.getByRole('status').filter({ hasText: 'Posted. Grocery run 1 of 1.' }),
  ).toHaveCount(1)
  const row = page.locator('[data-component="due-row"]').filter({ hasText: 'Grocery run' })
  await expect(row).toHaveAttribute('data-done', '')
  await expect(row.getByRole('img', { name: 'Done' })).toBeVisible()
  await expect(row.getByText('Task · by', { exact: false })).toContainText('Done')
  await expect(page.getByRole('button', { name: 'Check in Grocery run' })).toHaveCount(0)

  // Snap-first: the picker lists the task with its won't-count note; Close returns to the viewfinder.
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Check in', exact: true })
    .click()
  await camera.getByRole('button', { name: 'Take photo' }).click()
  await expect(camera.getByRole('heading', { name: "What's this check-in for?" })).toBeVisible()
  await expect(
    camera.getByRole('button', { name: "Grocery run, done · won't count" }),
  ).toBeVisible()
  await camera.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(camera.getByRole('button', { name: 'Take photo' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(camera).toBeHidden()
})
