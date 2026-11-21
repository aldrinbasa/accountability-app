import { expect, test } from './support/fixtures'
import { createFirstGroup, readInviteCode, signUp, tab } from './support/members'
import { addTaskToday, checkIn } from './support/plan'

/**
 * Story 5.3 against the local stack, in a group of two: Ben posts his task; Ada (the admin)
 * challenges it, which rules it Fake at once, then taps "Overturn (admin) until …" on the ruling
 * sticky. Both see the overturned line in place of the ruling, Ben's polaroid is back on both
 * walls, and Ben's Today shows the task done again.
 */
test('the admin overturns a Fake ruling and the check-in counts again', async ({
  page,
  newPhone,
}) => {
  await signUp(page, { name: 'Ada' })
  await createFirstGroup(page, 'Fair Crew')
  const code = await readInviteCode(page)

  const ben = await newPhone()
  await signUp(ben, { name: 'Ben', start: `/join/${code}` })
  await ben.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(ben).toHaveURL(/\/today\?g=/)

  // Ben posts his task (a reload first, so his Today is no longer waiting).
  await ben.reload()
  await addTaskToday(ben, 'Grocery run')
  await checkIn(ben, 'Grocery run')
  await expect(ben.getByRole('button', { name: 'Check in Grocery run' })).toHaveCount(0)

  // Ada: the Overflow on Ben's polaroid → Challenge → Rule it Fake (two members).
  await page.reload()
  await tab(page, 'Feed').click()
  const overflow = page.getByRole('button', { name: "More actions for Ben's Grocery run check-in" })
  await expect(overflow).toBeVisible({ timeout: 15_000 })
  await overflow.click()
  const actions = page.getByRole('dialog', { name: "Ben's Grocery run check-in" })
  await actions.getByRole('button', { name: 'Challenge' }).click()
  const confirm = page.getByRole('dialog', { name: "Challenge Ben's Grocery run?" })
  await confirm.getByRole('button', { name: 'Rule it Fake' }).click()
  await expect(confirm).toBeHidden()

  const adaRuling = page.locator('article[data-kind="ruling"]')
  const adaLine = adaRuling.getByRole('heading', { level: 2 })
  await expect(adaLine).toHaveText("Ruled Fake · You challenged · Ben's Grocery run removed.")
  await expect(page.getByRole('heading', { level: 2, name: /^Ben · Grocery run/ })).toHaveCount(0)

  // The admin's button-on-object names the week's lock; one tap overturns.
  const overturn = adaRuling.getByRole('button', { name: /^Overturn \(admin\) until / })
  await expect(overturn).toBeVisible()
  await overturn.click()
  await expect(adaLine).toHaveText("Overturned by you · Ben's Grocery run is back.")
  await expect(overturn).toHaveCount(0)
  // The Feed refetched: Ben's polaroid is back on Ada's wall.
  await expect(page.getByRole('heading', { level: 2, name: /^Ben · Grocery run/ })).toHaveCount(1, {
    timeout: 15_000,
  })

  // Ben's wall: the overturned line from his side and his polaroid back.
  await tab(ben, 'Feed').click()
  await ben.reload()
  const benRuling = ben.locator('article[data-kind="ruling"]')
  await expect(benRuling.getByRole('heading', { level: 2 })).toHaveText(
    'Overturned by Ada · Your Grocery run is back.',
    { timeout: 15_000 },
  )
  await expect(benRuling.getByRole('button', { name: /^Overturn \(admin\)/ })).toHaveCount(0)
  await expect(ben.getByRole('heading', { level: 2, name: /^You · Grocery run/ })).toHaveCount(1)

  // Ben's Today: the task reads done again.
  await tab(ben, 'Today').click()
  await ben.reload()
  const row = ben.locator('[data-component="due-row"]').filter({ hasText: 'Grocery run' })
  await expect(row).toHaveAttribute('data-done', '', { timeout: 15_000 })
  await expect(ben.getByRole('button', { name: 'Check in Grocery run' })).toHaveCount(0)
})
