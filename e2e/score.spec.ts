import type { Page } from '@playwright/test'
import { expect, test } from './support/fixtures'
import { createFirstGroup, readInviteCode, signUp } from './support/members'

/** A task due today, added from Today's "+ Add". */
async function addTaskToday(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Add a commitment or task' }).click()
  const sheet = page.getByRole('dialog', { name: 'Add a commitment or task' })
  await sheet.getByRole('radio', { name: 'Task' }).click()
  await sheet.getByRole('radio', { name: 'Groceries' }).click()
  await sheet.getByRole('textbox', { name: 'Name' }).fill(name)
  await sheet.getByRole('radio', { name: 'Today' }).click()
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(sheet).toBeHidden()
}

/** Checks in a row's task with the fake camera and waits for the camera to close. */
async function checkIn(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: `Check in ${name}` }).click()
  const camera = page.getByRole('dialog', { name: 'Camera' })
  await camera.getByRole('button', { name: 'Take photo' }).click()
  await camera.getByRole('button', { name: 'Post' }).click()
  await expect(camera).toBeHidden({ timeout: 30_000 })
}

function scoreSticker(page: Page, points: number) {
  return page.getByRole('link', { name: `${points} weekly points. Open the leaderboard` })
}

function rankChip(page: Page) {
  return page.locator('[data-component="rank-chip"]')
}

/**
 * Story 4.1 against the local stack: no Score sticker while the group waits; once a friend joins,
 * Today shows the weekly points from `get_board` and the rank chip; a post that moves the member
 * past someone ticks the sticker to `post_checkin`'s points, announces them with the rank and swaps
 * the chip to "#1 · passed Ben"; the sticker opens the Board.
 */
test('weekly points and rank on Today move with a post', async ({ page, newPhone }) => {
  await signUp(page, { name: 'Ada' })
  await createFirstGroup(page, 'Score Club')
  const code = await readInviteCode(page)
  // Waiting group: no score UI.
  await expect(page.getByText('Weekly points')).toHaveCount(0)
  await expect(rankChip(page)).toHaveCount(0)

  // Ben joins, plans two tasks due today and checks in one: 1 of 2 = 50, the only ranked member.
  const ben = await newPhone()
  await signUp(ben, { name: 'Ben', start: `/join/${code}` })
  await ben.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(ben).toHaveURL(/\/today\?g=/)
  await addTaskToday(ben, 'Errand one')
  await addTaskToday(ben, 'Errand two')
  await checkIn(ben, 'Errand one')
  await expect(scoreSticker(ben, 50)).toBeVisible()
  await expect(rankChip(ben)).toHaveText('#1')

  // Ada sees the group with two members, plans a task: 0 points, 2nd behind Ben.
  await page.reload()
  await addTaskToday(page, 'Grocery run')
  await expect(scoreSticker(page, 0)).toBeVisible()
  await expect(rankChip(page)).toHaveText("#2 · Ben's 50 ahead")

  // Ada's post: 100 points, rank 1, and she passed Ben.
  await checkIn(page, 'Grocery run')
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Posted. Grocery run 1 of 1. 100 weekly points. Rank 1.' }),
  ).toHaveCount(1)
  await expect(scoreSticker(page, 100)).toBeVisible()
  await expect(rankChip(page)).toHaveText('#1 · passed Ben')

  // The sticker opens the Board for the group.
  await scoreSticker(page, 100).click()
  await expect(page).toHaveURL(/\/board\?g=[0-9a-f-]{36}$/)
})
