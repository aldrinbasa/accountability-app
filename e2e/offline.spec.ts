import { expect, test } from './support/fixtures'
import { createFirstGroup, signUp } from './support/members'

/**
 * Story 3.3 against the local stack: a check-in posted with no network goes to the device outbox,
 * the camera closes at once and Today shows the photo-waiting Banner (with the offline Banner in the
 * top bar); once the connection returns the sender uploads both renditions and calls `post_checkin`,
 * the Banners go, the post moment plays and the row turns Done.
 */
test('post offline, then it sends when the connection returns', async ({ page, context }) => {
  await signUp(page, { name: 'Basement' })
  await createFirstGroup(page, 'Signal Club')

  // A task due today.
  await page.getByRole('button', { name: 'Add a habit or task' }).click()
  const sheet = page.getByRole('dialog', { name: 'Add a habit or task' })
  await sheet.getByRole('radio', { name: 'Task' }).click()
  await sheet.getByRole('radio', { name: 'Groceries' }).click()
  await sheet.getByRole('textbox', { name: 'Name' }).fill('Grocery run')
  await sheet.getByRole('radio', { name: 'Today' }).click()
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(sheet).toBeHidden()

  // The camera, the shutter and a caption while online; the network drops before Post.
  await page.getByRole('button', { name: 'Check in Grocery run' }).click()
  const camera = page.getByRole('dialog', { name: 'Camera' })
  await camera.getByRole('button', { name: 'Take photo' }).click()
  await camera.getByRole('textbox', { name: 'Caption' }).fill('no bars down here')
  await context.setOffline(true)
  await camera.getByRole('button', { name: 'Post' }).click()
  await expect(camera).toBeHidden()

  // Today: held, waiting, nothing posted yet.
  const waiting = page.getByText(
    /^1 photo waiting to send · Grocery run · Signal Club · taken \d\d:\d\d\./,
  )
  await expect(waiting).toBeVisible()
  await expect(page.getByText(/^Offline · showing what you had at \d\d:\d\d\.$/)).toBeVisible()
  await expect(page.locator('[data-component="post-moment"]')).toHaveCount(0)
  const row = page.locator('[data-component="due-row"]').filter({ hasText: 'Grocery run' })
  await expect(row).not.toHaveAttribute('data-done', '')

  // Back online: sent, the moment plays, the row is Done.
  await context.setOffline(false)
  await expect(waiting).toBeHidden({ timeout: 30_000 })
  await expect(page.getByText(/^Offline · showing/)).toHaveCount(0)
  const moment = page.locator('[data-component="post-moment"]')
  await expect(moment).toHaveAccessibleName(/^Your Grocery run check-in.*no bars down here$/)
  await expect(row).toHaveAttribute('data-done', '')
  await expect(row.getByRole('img', { name: 'Done' })).toBeVisible()
})
