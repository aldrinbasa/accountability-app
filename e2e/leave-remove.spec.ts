import { expect, test } from './support/fixtures'
import {
  createFirstGroup,
  openGroupSettings,
  readInviteCode,
  signUp,
  switcher,
  switcherName,
  tab,
} from './support/members'

// Matrix rows: Remove, Handover + delete (one continuous flow).
test('admin removes a member who rejoins, the admin hands over, the last member deletes the group', async ({
  page,
  newPhone,
}) => {
  await signUp(page, { name: 'Ari' })
  const groupId = await createFirstGroup(page, 'Hand Crew')
  const code = await readInviteCode(page)

  const friend = await newPhone()
  await signUp(friend, { name: 'Bo', start: `/join/${code}` })
  await friend.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(friend).toHaveURL(new RegExp(`/today\\?g=${groupId}$`))

  // Remove: the admin removes Bo from the Members list.
  await openGroupSettings(page, 'Hand Crew')
  await page.getByRole('button', { name: 'Remove Bo' }).click()
  const removeSheet = page.getByRole('dialog', { name: 'Remove Bo?' })
  await removeSheet.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(removeSheet).toBeHidden()
  await expect(page.getByRole('button', { name: 'Remove Bo' })).toHaveCount(0)

  // Bo: the group is gone and the notice shows once.
  const removed = friend.getByText("You're no longer in Hand Crew.")
  await friend.reload()
  await expect(friend.getByRole('heading', { name: 'Start a group' })).toBeVisible()
  await expect(removed).toBeVisible()
  // The device marked it seen.
  await expect
    .poll(() =>
      friend.evaluate(() =>
        Object.keys(localStorage).some((key) => key.startsWith('proofy.notice.removed.')),
      ),
    )
    .toBe(true)
  await friend.reload()
  await expect(friend.getByRole('heading', { name: 'Start a group' })).toBeVisible()
  // Absent for a sustained window (8 consecutive empty samples, 250 ms apart), not just once:
  // any sighting resets the run, so a toast raised after load fails the check.
  let emptySamples = 0
  await expect
    .poll(
      async () => {
        emptySamples = (await removed.count()) === 0 ? emptySamples + 1 : -1000
        return emptySamples
      },
      { intervals: [250], timeout: 5_000, message: 'removed notice stays absent' },
    )
    .toBeGreaterThanOrEqual(8)

  // Bo rejoins with the same invite.
  await friend.goto(`/join/${code}`)
  await expect(friend.getByRole('heading', { level: 1, name: 'Hand Crew' })).toBeVisible()
  await friend.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(friend).toHaveURL(new RegExp(`/today\\?g=${groupId}$`))
  await expect(switcher(friend)).toHaveAccessibleName(switcherName('Hand Crew'))

  // Handover: the admin leaves; the sheet names Bo as the next admin.
  await page.reload()
  await expect(page.getByRole('button', { name: 'Remove Bo' })).toBeVisible()
  await page.getByRole('button', { name: 'Leave group' }).click()
  const leaveSheet = page.getByRole('dialog', { name: 'Leave Hand Crew?' })
  await expect(leaveSheet).toContainText('Bo becomes admin.')
  await leaveSheet.getByRole('button', { name: 'Leave group' }).click()
  await expect(page).toHaveURL(/\/today$/)
  await expect(page.getByRole('heading', { name: 'Start a group' })).toBeVisible()

  // Bo is admin now, and leaving deletes the group.
  await friend.reload()
  await tab(friend, 'Me').click()
  const friendRow = friend.getByRole('link', { name: /Hand Crew/ })
  await expect(friendRow).toContainText(/admin/i)
  await friendRow.click()
  await expect(friend.getByRole('heading', { level: 1, name: 'Hand Crew' })).toBeVisible()
  await expect(friend.getByRole('heading', { name: 'Members' })).toBeVisible()
  await friend.getByRole('button', { name: 'Leave group' }).click()
  const lastSheet = friend.getByRole('dialog', { name: 'Leave Hand Crew?' })
  await expect(lastSheet).toContainText('This deletes the group.')
  await lastSheet.getByRole('button', { name: 'Leave group' }).click()
  await expect(friend).toHaveURL(/\/today$/)
  await expect(friend.getByRole('heading', { name: 'Start a group' })).toBeVisible()
})

// Epic 1 retro F1: a rejoin in the same session (no reload) must show the Join screen again, not
// bounce to Today on the invite preview cached by the first join.
test('a member who leaves can rejoin with the same code in the same session', async ({
  page,
  newPhone,
}) => {
  await signUp(page, { name: 'Cal' })
  const groupId = await createFirstGroup(page, 'Back Crew')
  const code = await readInviteCode(page)

  const friend = await newPhone()
  await signUp(friend, { name: 'Dot', start: `/join/${code}` })
  await friend.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(friend).toHaveURL(new RegExp(`/today\\?g=${groupId}$`))

  await openGroupSettings(friend, 'Back Crew')
  await friend.getByRole('button', { name: 'Leave group' }).click()
  const leaveSheet = friend.getByRole('dialog', { name: 'Leave Back Crew?' })
  await leaveSheet.getByRole('button', { name: 'Leave group' }).click()
  await expect(friend).toHaveURL(/\/today$/)
  await expect(friend.getByRole('heading', { name: 'Start a group' })).toBeVisible()

  // No reload: type the code on Today.
  await friend.getByLabel('Invite code').fill(code)
  await friend.getByRole('button', { name: 'Join with a code' }).click()
  await expect(friend).toHaveURL(new RegExp(`/join/${code}$`))
  await expect(friend.getByRole('heading', { level: 1, name: 'Back Crew' })).toBeVisible()
  await friend.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(friend).toHaveURL(new RegExp(`/today\\?g=${groupId}$`))
  await expect(switcher(friend)).toHaveAccessibleName(switcherName('Back Crew'))
})

test('leaving offline shows the cause in the sheet and keeps it open', async ({
  page,
  context,
}) => {
  await signUp(page, { name: 'Oli' })
  await createFirstGroup(page, 'Solo Crew')
  await openGroupSettings(page, 'Solo Crew')

  await page.getByRole('button', { name: 'Leave group' }).click()
  const sheet = page.getByRole('dialog', { name: 'Leave Solo Crew?' })
  await expect(sheet).toBeVisible()
  await context.setOffline(true)
  await sheet.getByRole('button', { name: 'Leave group' }).click()
  await expect(
    sheet.getByRole('alert').filter({ hasText: "You're offline. Group changes need a signal." }),
  ).toBeVisible()
  await expect(sheet).toBeVisible()
  await context.setOffline(false)
})
