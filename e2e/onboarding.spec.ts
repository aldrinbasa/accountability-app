import { expect, test } from './support/fixtures'
import { createFirstGroup, INSTALL_HINT, signUp, switcher } from './support/members'

// Matrix rows: New member, Create, Offline create (one continuous flow).
test('a new member signs in with a code, skips install, sets up, then creates a group', async ({
  page,
  context,
}) => {
  // New member: code sign-in, install guide, Setup, Today.
  await signUp(page, { name: 'Ana' })
  await expect(page).toHaveURL(/\/today$/)
  await expect(page.getByRole('heading', { name: 'Start a group' })).toBeVisible()
  // On this Android profile Today's install notice is the Hint (the Banner is iOS Safari only).
  await expect(page.getByText(INSTALL_HINT)).toBeVisible()
  await expect(switcher(page)).toHaveCount(0)

  // Create with an empty name: a field error, no group.
  await page.getByRole('button', { name: 'Create a group' }).click()
  await expect(page.getByText('Give the group a name.')).toBeVisible()
  await expect(switcher(page)).toHaveCount(0)

  // Offline create: Inline retry, the name stays.
  const nameField = page.getByLabel('Group name')
  await nameField.fill('Morning Crew')
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Create a group' }).click()
  await expect(
    page.getByRole('alert').filter({ hasText: "You're offline. Groups need a signal to start." }),
  ).toBeVisible()
  await expect(nameField).toHaveValue('Morning Crew')
  await expect(switcher(page)).toHaveCount(0)
  await context.setOffline(false)

  // Create: waiting state, switcher named, ?g= set.
  await createFirstGroup(page, 'Morning Crew')
})
