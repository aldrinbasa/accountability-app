import { expect, test } from './support/fixtures'
import {
  createFirstGroup,
  groupIdFromUrl,
  signUp,
  switcher,
  switcherName,
  tab,
} from './support/members'

test('switching groups moves ?g= and the switcher, and the focus survives a reload and tabs', async ({
  page,
}) => {
  await signUp(page, { name: 'Sol' })
  const alpha = await createFirstGroup(page, 'Alpha Club')

  // A second group from the switcher sheet.
  await switcher(page).click()
  const list = page.getByRole('dialog', { name: 'Your groups' })
  await list.getByRole('button', { name: 'Create or join a group' }).click()
  const create = page.getByRole('dialog', { name: 'Start a group' })
  await create.getByLabel('Group name').fill('Bravo Club')
  await create.getByRole('button', { name: 'Create a group' }).click()
  await expect(create).toBeHidden()
  await expect(switcher(page)).toHaveAccessibleName(switcherName('Bravo Club'))
  await expect(page).not.toHaveURL(new RegExp(`[?&]g=${alpha}`))
  const bravo = groupIdFromUrl(page)
  expect(bravo).not.toBe(alpha)

  // Switch back.
  await switcher(page).click()
  await page
    .getByRole('dialog', { name: 'Your groups' })
    .getByRole('button', { name: /Alpha Club/ })
    .click()
  await expect(page).toHaveURL(new RegExp(`/today\\?g=${alpha}$`))
  await expect(switcher(page)).toHaveAccessibleName(switcherName('Alpha Club'))

  // A reload keeps the focused group, with and without ?g=.
  await page.reload()
  await expect(switcher(page)).toHaveAccessibleName(switcherName('Alpha Club'))
  await expect(page).toHaveURL(new RegExp(`/today\\?g=${alpha}$`))
  await page.goto('/today')
  await expect(switcher(page)).toHaveAccessibleName(switcherName('Alpha Club'))
  await expect(page).toHaveURL(new RegExp(`/today\\?g=${alpha}$`))

  // Feed keeps ?g=.
  await tab(page, 'Feed').click()
  await expect(page.getByRole('heading', { level: 1, name: 'Feed' })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/feed\\?g=${alpha}$`))
  await expect(switcher(page)).toHaveAccessibleName(switcherName('Alpha Club'))
})

test('Me shows the name and My groups, and a group opens its settings', async ({ page }) => {
  await signUp(page, { name: 'Mia' })
  await createFirstGroup(page, 'Mia Squad')

  await tab(page, 'Me').click()
  await expect(page.getByRole('heading', { level: 1, name: 'Me' })).toBeVisible()
  await expect(page.getByText('Mia', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'My groups' })).toBeVisible()
  const row = page.getByRole('link', { name: /Mia Squad/ })
  await expect(row).toContainText(/admin/i)
  await expect(row).toContainText('waiting for a 2nd member')

  await row.click()
  await expect(page).toHaveURL(/\/me\/groups\/[0-9a-f-]{36}/)
  await expect(page.getByRole('heading', { level: 1, name: 'Mia Squad' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Group time zone' })).toBeVisible()
})

test('Settings Appearance sets light or dark on this device and survives a reload', async ({
  page,
}) => {
  await signUp(page, { name: 'Theo' })
  await createFirstGroup(page, 'Theo Crew')

  await tab(page, 'Me').click()
  await page.getByRole('link', { name: 'Settings' }).click()
  const appearance = page.getByRole('radiogroup', { name: 'Appearance' })
  await expect(appearance.getByRole('radio', { name: 'Auto' })).toBeChecked()

  await appearance.getByRole('radio', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(
    page.getByRole('radiogroup', { name: 'Appearance' }).getByRole('radio', { name: 'Dark' }),
  ).toBeChecked()

  await page
    .getByRole('radiogroup', { name: 'Appearance' })
    .getByRole('radio', { name: 'Light' })
    .click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})
