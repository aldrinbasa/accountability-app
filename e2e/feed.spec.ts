import { expect, test } from './support/fixtures'
import { createFirstGroup, readInviteCode, signUp, tab } from './support/members'

/**
 * Story 3.4 against the local stack: a check-in posted from Today shows on the Feed wall as a
 * polaroid (h2, meta, caption, photo from a signed URL), the Photo viewer opens from the photo and
 * returns focus to it on close, and a second member's join appears as a sticky.
 */
test('a posted check-in lands on the Feed, opens in the viewer, and a join leaves a sticky', async ({
  page,
  newPhone,
}) => {
  await signUp(page, { name: 'Ada' })
  await createFirstGroup(page, 'Feed Crew')
  const code = await readInviteCode(page)

  // A task due today, checked in from its row.
  await page.getByRole('button', { name: 'Add a commitment or task' }).click()
  const sheet = page.getByRole('dialog', { name: 'Add a commitment or task' })
  await sheet.getByRole('radio', { name: 'Task' }).click()
  await sheet.getByRole('radio', { name: 'Groceries' }).click()
  await sheet.getByRole('textbox', { name: 'Name' }).fill('Grocery run')
  await sheet.getByRole('radio', { name: 'Today' }).click()
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(sheet).toBeHidden()

  await page.getByRole('button', { name: 'Check in Grocery run' }).click()
  const camera = page.getByRole('dialog', { name: 'Camera' })
  await camera.getByRole('button', { name: 'Take photo' }).click()
  await camera.getByRole('textbox', { name: 'Caption' }).fill('milk, eggs, done')
  await camera.getByRole('button', { name: 'Post' }).click()
  await expect(camera).toBeHidden({ timeout: 30_000 })
  await expect(
    page.getByRole('status').filter({ hasText: 'Posted. Grocery run 1 of 1.' }),
  ).toHaveCount(1)

  // The Feed: one h1 with the group for screen readers, the waiting block, then the polaroid.
  await tab(page, 'Feed').click()
  await expect(page.getByRole('heading', { level: 1, name: 'Feed · Feed Crew' })).toBeVisible()
  await expect(page.getByText('Just you in here so far.')).toBeVisible()
  const polaroid = page.getByRole('article').filter({
    has: page.getByRole('heading', { level: 2, name: /^You · Grocery run · \d\d:\d\d$/ }),
  })
  await expect(polaroid).toBeVisible()
  await expect(polaroid.getByText('milk, eggs, done')).toBeVisible()
  // Meta: a task shows no fraction.
  await expect(polaroid.locator('figure > p')).toHaveText(/^You · Grocery run · \d\d:\d\d$/)

  // The photo comes from a signed URL and actually loads.
  const photo = polaroid.getByRole('img', {
    name: /^Your Grocery run check-in, \d\d:\d\d, caption: milk, eggs, done$/,
  })
  await expect(photo).toBeVisible()
  await expect(photo).toHaveAttribute(
    'src',
    /\/storage\/v1\/object\/sign\/checkins\/.+\/360\.webp\?token=/,
  )
  await expect
    .poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true)

  // The Photo viewer: full screen, caption and meta below, no other controls; Esc returns focus.
  const opener = polaroid.getByRole('button', { name: /^Your Grocery run check-in/ })
  await opener.click()
  const viewer = page.getByRole('dialog', { name: /^You · Grocery run · \d\d:\d\d$/ })
  await expect(viewer).toBeVisible()
  await expect(viewer.getByText('milk, eggs, done')).toBeVisible()
  await expect(viewer.getByRole('button')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(viewer).toBeHidden()
  await expect(opener).toBeFocused()

  // A friend joins: the Feed shows the sticky.
  const friend = await newPhone()
  await signUp(friend, { name: 'Ben', start: `/join/${code}` })
  await friend.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(friend).toHaveURL(/\/today\?g=/)

  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Feed · Feed Crew' })).toBeVisible()
  await expect(page.getByRole('article').filter({ hasText: 'Ben joined.' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Ben joined.' })).toBeVisible()
  // The friend sees the same wall, with the join as their own.
  await tab(friend, 'Feed').click()
  await expect(friend.getByRole('heading', { level: 2, name: 'You joined.' })).toBeVisible()
  await expect(
    friend.getByRole('heading', { level: 2, name: /^Ada · Grocery run · \d\d:\d\d$/ }),
  ).toBeVisible()
})
