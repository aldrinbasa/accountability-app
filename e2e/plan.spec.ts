import { expect, test } from './support/fixtures'
import { createFirstGroup, signUp, tab } from './support/members'

/**
 * Epic 2 against the local stack (retro V3): add a times-per-week habit from Today's Plan
 * sheet, see it under "Your plan here", edit its target from My plan (Today follows), then end it
 * before it starts: it moves to Past and leaves Today.
 */
test('add a habit, edit it from My plan, end it', async ({ page }) => {
  await signUp(page, { name: 'Plan' })
  await createFirstGroup(page, 'Plan Crew')

  // Add Run, 3 times per week; it starts next Monday.
  await page.getByRole('button', { name: 'Add a habit or task' }).click()
  const sheet = page.getByRole('dialog', { name: 'Add a habit or task' })
  await sheet.getByRole('radio', { name: 'Run', exact: true }).click()
  await sheet.getByRole('radio', { name: 'Times per week', exact: true }).click()
  await expect(sheet.getByRole('group', { name: 'Times per week' })).toContainText(
    '3 times per week',
  )
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(sheet).toBeHidden()

  const planHere = page.getByRole('region', { name: /^Your plan here/ })
  await expect(
    planHere.getByText(/^3 times per week · starts Mon \d{1,2} [A-Z][a-z]{2}$/),
  ).toBeVisible()

  // Me > My plan > Edit Run: 4 times per week.
  await tab(page, 'Me').click()
  await page.getByRole('link', { name: 'My plan', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'My plan' })).toBeVisible()
  const current = page.getByRole('region', { name: 'Current' })
  await expect(current.getByRole('heading', { level: 3, name: 'Run', exact: true })).toBeVisible()

  await current.getByRole('button', { name: 'Edit Run', exact: true }).click()
  const edit = page.getByRole('dialog', { name: 'Edit habit' })
  await expect(edit.getByRole('group', { name: 'Times per week' })).toContainText(
    '3 times per week',
  )
  await edit.getByRole('button', { name: 'More', exact: true }).click()
  await expect(edit.getByRole('group', { name: 'Times per week' })).toContainText(
    '4 times per week',
  )
  await edit.getByRole('button', { name: 'Save' }).click()
  await expect(edit).toBeHidden()
  await expect(
    current.getByText(/^4 times per week · starts Mon \d{1,2} [A-Z][a-z]{2}$/),
  ).toBeVisible()

  // Today follows the edit.
  await tab(page, 'Today').click()
  await expect(page).toHaveURL(/\/today\?g=/)
  await expect(
    planHere.getByText(/^4 times per week · starts Mon \d{1,2} [A-Z][a-z]{2}$/),
  ).toBeVisible()

  // End it before it starts: Past in My plan, gone from Today.
  await tab(page, 'Me').click()
  await page.getByRole('link', { name: 'My plan', exact: true }).click()
  await current.getByRole('button', { name: 'Edit Run', exact: true }).click()
  await edit.getByRole('button', { name: 'End habit' }).click()
  const confirm = page.getByRole('dialog', { name: 'End Run?' })
  await confirm.getByRole('button', { name: 'End', exact: true }).click()
  await expect(confirm).toBeHidden()
  const past = page.getByRole('region', { name: 'Past' })
  await expect(past.getByRole('heading', { level: 3, name: 'Run', exact: true })).toBeVisible()
  await expect(current.getByRole('heading', { level: 3, name: 'Run', exact: true })).toHaveCount(0)

  await tab(page, 'Today').click()
  await expect(page).toHaveURL(/\/today\?g=/)
  await expect(page.getByRole('button', { name: 'Add a habit or task' })).toBeVisible()
  await expect(planHere).toHaveCount(0)
})
