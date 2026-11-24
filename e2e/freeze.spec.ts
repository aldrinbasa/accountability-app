import type { Page } from '@playwright/test'
import { expect, test } from './support/fixtures'
import { createFirstGroup, readInviteCode, signUp } from './support/members'
import { addTaskToday, dueRow } from './support/plan'

/** The row's Overflow → "Request freeze" → the Freeze sheet. */
async function openFreezeSheet(page: Page, title: string) {
  await page.getByRole('button', { name: `More actions for ${title}`, exact: true }).click()
  const actions = page.getByRole('dialog', { name: title, exact: true })
  await actions.getByRole('button', { name: 'Request freeze' }).click()
  const sheet = page.getByRole('dialog', { name: 'Request freeze' })
  await expect(sheet).toBeVisible()
  return sheet
}

/**
 * Story 5.4 against the local stack, alone in a group: Ada plans a task due today and asks to
 * freeze it from the row's Overflow. Send with no reason shows the Field error; with a reason the
 * request is approved at once (one member), the toast says so and the row reads "Frozen · flu"
 * without Check in.
 */
test('alone in a group, a freeze request is approved at once', async ({ page }) => {
  await signUp(page, { name: 'Ada' })
  await createFirstGroup(page, 'Solo Freeze')
  await addTaskToday(page, 'Grocery run')

  const sheet = await openFreezeSheet(page, 'Grocery run')
  await expect(sheet.getByText(/^Grocery run on [A-Z][a-z]{2}$/)).toBeVisible()
  await expect(
    sheet.getByText("Just you in this group, so it's approved right away."),
  ).toBeVisible()

  await sheet.getByRole('button', { name: 'Send' }).click()
  await expect(sheet.getByRole('alert')).toHaveText('Add a reason so the group knows why.')
  await expect(sheet.getByRole('textbox', { name: 'Reason' })).toBeFocused()

  await sheet.getByRole('textbox', { name: 'Reason' }).fill('flu')
  await sheet.getByRole('button', { name: 'Send' }).click()
  await expect(sheet).toBeHidden()
  await expect(
    page
      .locator('[data-sonner-toast]')
      .filter({ hasText: /^Freeze approved · Grocery run on [A-Z][a-z]{2} is off the plan\.$/ }),
  ).toHaveCount(1)

  const row = dueRow(page, 'Grocery run')
  await expect(row).toHaveAttribute('data-frozen', '', { timeout: 15_000 })
  await expect(row.getByText('Frozen · flu', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Check in Grocery run' })).toHaveCount(0)
})

/**
 * Story 5.4 in a group of two: Ben asks to freeze his task due today. The group votes, so the
 * toast says "Freeze requested." and his row shows the pending meta "Freeze vote · … left" with
 * Check in still there.
 */
test('in a group, a freeze request waits on the vote', async ({ page, newPhone }) => {
  await signUp(page, { name: 'Ada' })
  await createFirstGroup(page, 'Freeze Crew')
  const code = await readInviteCode(page)

  const ben = await newPhone()
  await signUp(ben, { name: 'Ben', start: `/join/${code}` })
  await ben.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(ben).toHaveURL(/\/today\?g=/)

  await addTaskToday(ben, 'Errand one')
  const sheet = await openFreezeSheet(ben, 'Errand one')
  await expect(sheet.getByText('The group votes for 24 h. No votes means approved.')).toBeVisible()
  await sheet.getByRole('textbox', { name: 'Reason' }).fill('flu, in bed')
  await sheet.getByRole('button', { name: 'Send' }).click()
  await expect(sheet).toBeHidden()
  await expect(
    ben.locator('[data-sonner-toast]').filter({ hasText: /^Freeze requested\.$/ }),
  ).toHaveCount(1)

  const row = dueRow(ben, 'Errand one')
  // Under 1 h before the week's lock the vote shows minutes instead of hours.
  await expect(row.locator('[data-freeze-meta]')).toHaveText(/^Freeze vote · \d+ (h|min) left$/, {
    timeout: 15_000,
  })
  await expect(row).not.toHaveAttribute('data-frozen', '')
  await expect(ben.getByRole('button', { name: 'Check in Errand one' })).toBeVisible()
})
