import { expect, test } from './support/fixtures'
import { createFirstGroup, readInviteCode, signUp, tab } from './support/members'
import { addTaskToday, checkIn } from './support/plan'

/**
 * Story 4.3 against the local stack. Alone in her group, Ada plans a task and checks in: Today shows
 * her Score sticker (100, no rank chip) and the Board shows her own block with the waiting line and
 * Invite (2026-11-20 decision: a solo member scores). Once Ben joins and plans a task, Ada's Board is
 * the leaderboard: the h1 "Leaderboard · {Group}", the week chip, and a podium list in rank order
 * with Ada 1st on 100 and Ben 2nd on 0.
 */
test('the Board shows a solo week, then the podium once a friend joins', async ({
  page,
  newPhone,
}) => {
  await signUp(page, { name: 'Ada' })
  await createFirstGroup(page, 'Podium Club')
  const code = await readInviteCode(page)

  await addTaskToday(page, 'Grocery run')
  await checkIn(page, 'Grocery run')
  await expect(
    page.getByRole('link', { name: '100 weekly points. Open the leaderboard' }),
  ).toBeVisible()
  await expect(page.locator('[data-component="rank-chip"]')).toHaveCount(0)
  // The waiting body says her habits already score (Epic 4 retro F6).
  await expect(
    page.getByText(
      'Your habits already score. Bring friends in to make it a game: a leaderboard, votes and a weekly winner.',
    ),
  ).toBeVisible()

  await tab(page, 'Board').click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Leaderboard · Podium Club' }),
  ).toBeVisible()
  await expect(page.locator('[data-component="solo-stand"]')).toContainText(
    'Ada, 100 weekly points, 1 task.',
  )
  await expect(page.getByText('The leaderboard starts when a second friend joins.')).toBeVisible()
  await page.getByRole('button', { name: 'Invite', exact: true }).click()
  await expect(page.locator('[data-component="invite-panel"]')).toBeVisible()

  // Ben joins and plans a task: 0 of 1.
  const ben = await newPhone()
  await signUp(ben, { name: 'Ben', start: `/join/${code}` })
  await ben.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(ben).toHaveURL(/\/today\?g=/)
  await addTaskToday(ben, 'Errand one')

  await page.reload()
  await expect(page.getByText(/^This week · locks Wed 23:59/)).toBeVisible()
  const places = page.getByRole('list', { name: "This week's podium" }).getByRole('listitem')
  await expect(places).toHaveCount(2)
  await expect(places.nth(0)).toContainText('Ada, rank 1, 100 weekly points, 1 task.')
  await expect(places.nth(1)).toContainText('Ben, rank 2, 0 weekly points, 1 task.')
  await expect(page.locator('[data-component="solo-stand"]')).toHaveCount(0)
})
