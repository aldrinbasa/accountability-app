import { expect, test } from './support/fixtures'
import { createFirstGroup, readInviteCode, signUp, switcher, switcherName } from './support/members'

test('a signed-out friend opens the invite link, signs in, sets up and joins', async ({
  page,
  newPhone,
}) => {
  await signUp(page, { name: 'Ada' })
  const groupId = await createFirstGroup(page, 'Join Crew')
  const code = await readInviteCode(page)

  const friend = await newPhone()
  await signUp(friend, { name: 'Ben', start: `/join/${code}` })
  await expect(friend).toHaveURL(new RegExp(`/join/${code}$`))
  await expect(friend.getByRole('heading', { level: 1, name: 'Join Crew' })).toBeVisible()
  await expect(friend.getByText('Ada is the admin')).toBeVisible()
  await friend.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(friend).toHaveURL(new RegExp(`/today\\?g=${groupId}$`))
  await expect(switcher(friend)).toHaveAccessibleName(switcherName('Join Crew'))

  // The admin's group is no longer waiting.
  await page.reload()
  await expect(switcher(page)).toHaveAccessibleName(switcherName('Join Crew'))
  // Anchor on the loaded two-member state first, so the negative check cannot pass on stale data.
  await switcher(page).click()
  const sheet = page.getByRole('dialog', { name: 'Your groups' })
  await expect(sheet.getByRole('button', { name: /Join Crew/ })).toContainText('2 members')
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(page.getByText('Just you in here so far.')).toHaveCount(0)
})

test('a code typed in lower case with spaces opens the join screen', async ({ page, newPhone }) => {
  await signUp(page, { name: 'Cal' })
  await createFirstGroup(page, 'Code Crew')
  const code = await readInviteCode(page)

  const friend = await newPhone()
  await signUp(friend, { name: 'Dee' })
  await expect(friend.getByRole('heading', { name: 'Start a group' })).toBeVisible()
  await friend.getByLabel('Invite code').fill(` ${code.toLowerCase()} `)
  await friend.getByRole('button', { name: 'Join with a code' }).click()
  await expect(friend).toHaveURL(new RegExp(`/join/${code}$`))
  await expect(friend.getByRole('heading', { level: 1, name: 'Code Crew' })).toBeVisible()
  await expect(friend.getByRole('button', { name: 'Join', exact: true })).toBeVisible()
})

test('an unknown code says so and offers Today', async ({ page }) => {
  await signUp(page, { name: 'Eve', start: '/join/ZZZZZZ' })
  await expect(page).toHaveURL(/\/join\/ZZZZZZ$/)
  await expect(
    page.getByText("That invite code doesn't work. Check it with whoever sent it."),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Go to Today' }).click()
  await expect(page).toHaveURL(/\/today/)
  await expect(page.getByRole('heading', { name: 'Start a group' })).toBeVisible()
})
