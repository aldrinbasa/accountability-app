import { expect, test } from './support/fixtures'
import { createFirstGroup, openGroupSettings, readInviteCode, signUp, tab } from './support/members'
import { addTaskToday, checkIn } from './support/plan'

const RITUAL =
  "The photo's a ritual, not a court case. Question a check-in only when something's clearly off."

/**
 * Story 5.6 against the local stack, in a group of three: Ada posts her task and Ben questions it.
 * Cy finds the ritual Hint and the Vote card in Today's "Open votes", votes Counts there and undoes
 * it. Then Ada leaves the group: the vote is cancelled, the Feed card reads "Cancelled · Ada left
 * the group" without the photo, and Cy's Open votes empties.
 */
test('a member votes from Today; the vote is cancelled when the owner leaves', async ({
  page,
  newPhone,
}) => {
  await signUp(page, { name: 'Ada' })
  await createFirstGroup(page, 'Open Crew')
  const code = await readInviteCode(page)

  const ben = await newPhone()
  await signUp(ben, { name: 'Ben', start: `/join/${code}` })
  await ben.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(ben).toHaveURL(/\/today\?g=/)

  const cy = await newPhone()
  await signUp(cy, { name: 'Cy', start: `/join/${code}` })
  await cy.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(cy).toHaveURL(/\/today\?g=/)

  await page.reload()
  await ben.reload()
  await addTaskToday(page, 'Grocery run')
  await checkIn(page, 'Grocery run')
  await expect(page.getByRole('button', { name: 'Check in Grocery run' })).toHaveCount(0)

  // Ben questions Ada's check-in.
  await tab(ben, 'Feed').click()
  const overflow = ben.getByRole('button', { name: "More actions for Ada's Grocery run check-in" })
  await expect(overflow).toBeVisible({ timeout: 15_000 })
  await overflow.click()
  await ben
    .getByRole('dialog', { name: "Ada's Grocery run check-in" })
    .getByRole('button', { name: 'Question it', exact: true })
    .click()
  const confirm = ben.getByRole('dialog', { name: "Question Ada's Grocery run?" })
  await confirm.getByRole('button', { name: 'Question it', exact: true }).click()
  await expect(confirm).toBeHidden()
  await expect(ben.locator('article[data-kind="vote"]')).toHaveCount(1)

  // Cy: the ritual Hint, then the card in Today's Open votes.
  await cy.reload()
  const hint = cy.locator('[data-component="hint"]').filter({ hasText: RITUAL })
  await expect(hint).toBeVisible()
  await hint.getByRole('button', { name: 'Not now', exact: true }).click()
  await expect(hint).toHaveCount(0)

  const openVotes = cy.locator('section[data-component="open-votes"]')
  await expect(openVotes.getByRole('heading', { level: 2, name: 'Open votes' })).toBeVisible({
    timeout: 15_000,
  })
  const card = openVotes.locator('article[data-kind="vote"]')
  await expect(card).toHaveCount(1)
  await expect(card.getByText("Ben questioned Ada's Grocery run check-in.")).toBeVisible()
  await expect(card.getByText('1 of 2 voted', { exact: true })).toBeVisible()

  // Counts from Today, then Undo inside the 5 s window (so the vote stays open).
  await card.getByRole('button', { name: 'Vote: counts', exact: true }).click()
  await expect(card.getByText('You said it counts · 2 of 2 voted', { exact: true })).toBeVisible()
  const toast = cy.locator('[data-sonner-toast]')
  await expect(toast.getByText('You said it counts', { exact: true })).toBeVisible()
  await toast.getByRole('button', { name: 'Undo' }).click()
  await expect(card.getByRole('button', { name: 'Vote: counts', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await expect(card.getByRole('status')).toHaveText('Vote undone.')

  // The Hint stays dismissed on this device.
  await cy.reload()
  await expect(openVotes.locator('article[data-kind="vote"]')).toHaveCount(1, { timeout: 15_000 })
  await expect(cy.getByText(RITUAL, { exact: true })).toHaveCount(0)

  // Ada leaves: her check-in's challenge is cancelled.
  await openGroupSettings(page, 'Open Crew')
  await page.getByRole('button', { name: 'Leave group' }).click()
  const leaveSheet = page.getByRole('dialog', { name: 'Leave Open Crew?' })
  await leaveSheet.getByRole('button', { name: 'Leave group' }).click()
  await expect(leaveSheet).toBeHidden()

  await cy.reload()
  await tab(cy, 'Feed').click()
  const feedCard = cy.locator('article[data-kind="vote"]')
  await expect(feedCard.getByText('Cancelled · Ada left the group', { exact: true })).toBeVisible({
    timeout: 15_000,
  })
  await expect(feedCard.getByText('QUESTION', { exact: true })).toHaveClass(/line-through/)
  await expect(feedCard.getByRole('button')).toHaveCount(0)

  // Nothing waits on Today anymore.
  await tab(cy, 'Today').click()
  await expect(cy.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(cy.locator('section[data-component="open-votes"]')).toHaveCount(0, {
    timeout: 15_000,
  })
})
