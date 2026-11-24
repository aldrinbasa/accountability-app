import { expect, test } from './support/fixtures'
import { createFirstGroup, readInviteCode, signUp, tab } from './support/members'
import { addTaskToday, checkIn } from './support/plan'

/**
 * Story 5.1 against the local stack, in a group of two: Ada posts her task; Ben challenges it from
 * the Feed polaroid's Overflow and confirms "Don't count it". The challenge rules Fake at once: both
 * see the lavender ruling sticky, the polaroid leaves both walls, and Ada's task is open again
 * (its session has not ended), so Today offers "Check in Grocery run" once more.
 */
test('a two-person challenge rules Fake at once and frees the session', async ({
  page,
  newPhone,
}) => {
  await signUp(page, { name: 'Ada' })
  await createFirstGroup(page, 'Honest Crew')
  const code = await readInviteCode(page)

  const ben = await newPhone()
  await signUp(ben, { name: 'Ben', start: `/join/${code}` })
  await ben.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(ben).toHaveURL(/\/today\?g=/)

  // Ada sees the second member before planning, so her Today is no longer waiting.
  await page.reload()
  await addTaskToday(page, 'Grocery run')
  await checkIn(page, 'Grocery run')
  await expect(page.getByRole('button', { name: 'Check in Grocery run' })).toHaveCount(0)

  // Ben: the Overflow on Ada's polaroid → Challenge → the two-person confirm.
  await tab(ben, 'Feed').click()
  const overflow = ben.getByRole('button', { name: "More actions for Ada's Grocery run check-in" })
  await expect(overflow).toBeVisible({ timeout: 15_000 })
  await overflow.click()
  const actions = ben.getByRole('dialog', { name: "Ada's Grocery run check-in" })
  await actions.getByRole('button', { name: 'Question it', exact: true }).click()
  const confirm = ben.getByRole('dialog', { name: "Question Ada's Grocery run?" })
  await expect(
    confirm.getByText("It's just the two of you, so it stops counting right away. No vote."),
  ).toBeVisible()
  await confirm.getByRole('button', { name: "Don't count it", exact: true }).click()
  await expect(confirm).toBeHidden()

  // Ben's wall: the ruling sticky, no polaroid.
  const benRuling = ben.locator('article[data-kind="ruling"]')
  await expect(benRuling.getByRole('heading', { level: 2 })).toHaveText(
    "Didn't count · Ada's Grocery run · You questioned it.",
  )
  await expect(benRuling.getByText('Result', { exact: true })).toBeVisible()
  await expect(ben.getByRole('heading', { level: 2, name: /^Ada · Grocery run/ })).toHaveCount(0)

  // Ada's wall: the same ruling from her side, her polaroid gone.
  await tab(page, 'Feed').click()
  const adaRuling = page.locator('article[data-kind="ruling"]')
  await expect(adaRuling.getByRole('heading', { level: 2 })).toHaveText(
    "Didn't count · Your Grocery run · Ben questioned it.",
  )
  await expect(page.getByRole('heading', { level: 2, name: /^You · Grocery run/ })).toHaveCount(0)

  // Ada's task is open again (a reload: Today may still hold its pre-ruling rows).
  await tab(page, 'Today').click()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Check in Grocery run' })).toBeVisible()
})
