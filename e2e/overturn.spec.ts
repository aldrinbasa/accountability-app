import { execFileSync } from 'node:child_process'
import { expect, test } from './support/fixtures'
import { createFirstGroup, readInviteCode, signUp, tab } from './support/members'
import { addTaskToday, checkIn, dueRow } from './support/plan'

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

  // Ada: the Overflow on Ben's polaroid → Question it → Don't count it (two members).
  await page.reload()
  await tab(page, 'Feed').click()
  const overflow = page.getByRole('button', { name: "More actions for Ben's Grocery run check-in" })
  await expect(overflow).toBeVisible({ timeout: 15_000 })
  await overflow.click()
  const actions = page.getByRole('dialog', { name: "Ben's Grocery run check-in" })
  await actions.getByRole('button', { name: 'Question it', exact: true }).click()
  const confirm = page.getByRole('dialog', { name: "Question Ben's Grocery run?" })
  await confirm.getByRole('button', { name: "Don't count it", exact: true }).click()
  await expect(confirm).toBeHidden()

  const adaRuling = page.locator('article[data-kind="ruling"]')
  const adaLine = adaRuling.getByRole('heading', { level: 2 })
  await expect(adaLine).toHaveText("Didn't count · Ben's Grocery run · You questioned it.")
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

/**
 * Epic 5 retro (F1) against the local stack, in a group of two: Ada (the admin) questions Ben's
 * task, which rules "doesn't count" at once while the day is still open, so Ben may still ask to
 * freeze it. The request is approved by tick step 3 (psql, no ballots: approved). Then Ada
 * overturns the ruling in the UI: the server cancels the freeze, so her Feed's freeze card reads
 * "Cancelled · the check-in counts again", the "Freeze approved" sticky is gone, and Ben's task
 * reads done, not frozen. Needs DB_URL (CI sets it) to close the vote.
 */
test('an overturn cancels the freeze on the ruled session', async ({ page, newPhone }) => {
  const dbUrl = process.env.DB_URL
  test.skip(!dbUrl, 'needs DB_URL to close the freeze vote')

  await signUp(page, { name: 'Ada' })
  const groupId = await createFirstGroup(page, 'Thaw Crew')
  const code = await readInviteCode(page)

  const ben = await newPhone()
  await signUp(ben, { name: 'Ben', start: `/join/${code}` })
  await ben.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(ben).toHaveURL(/\/today\?g=/)

  await ben.reload()
  await addTaskToday(ben, 'Grocery run')
  await checkIn(ben, 'Grocery run')
  await expect(ben.getByRole('button', { name: 'Check in Grocery run' })).toHaveCount(0)

  // Ada questions it; two members, so it stops counting at once.
  await page.reload()
  await tab(page, 'Feed').click()
  const overflow = page.getByRole('button', { name: "More actions for Ben's Grocery run check-in" })
  await expect(overflow).toBeVisible({ timeout: 15_000 })
  await overflow.click()
  await page
    .getByRole('dialog', { name: "Ben's Grocery run check-in" })
    .getByRole('button', { name: 'Question it', exact: true })
    .click()
  const confirm = page.getByRole('dialog', { name: "Question Ben's Grocery run?" })
  await confirm.getByRole('button', { name: "Don't count it", exact: true }).click()
  await expect(confirm).toBeHidden()
  const adaRuling = page.locator('article[data-kind="ruling"]')
  await expect(adaRuling.getByRole('heading', { level: 2 })).toHaveText(
    "Didn't count · Ben's Grocery run · You questioned it.",
  )

  // Ben: the day is still open, so he may ask to freeze it.
  await ben.reload()
  await expect(ben.getByRole('button', { name: 'Check in Grocery run' })).toBeVisible({
    timeout: 15_000,
  })
  await ben.getByRole('button', { name: 'More actions for Grocery run', exact: true }).click()
  await ben
    .getByRole('dialog', { name: 'Grocery run', exact: true })
    .getByRole('button', { name: 'Request freeze' })
    .click()
  const sheet = ben.getByRole('dialog', { name: 'Request freeze' })
  await sheet.getByRole('textbox', { name: 'Reason' }).fill('flu, in bed')
  await sheet.getByRole('button', { name: 'Send' }).click()
  await expect(sheet).toBeHidden()

  // Close it now: nobody voted, so tick step 3 approves it.
  execFileSync(
    'psql',
    [
      dbUrl ?? '',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `update public.freeze_requests set early_close_at = now()
       where group_id = '${groupId}' and closed_at is null;`,
      '-c',
      "do $$ declare e text := private.tick_step_3_close_votes(); begin if e is not null then raise exception '%', e; end if; end $$;",
    ],
    { stdio: 'pipe' },
  )

  await page.reload()
  const result = page.locator('article[data-kind="freeze-result"]')
  await expect(result.getByRole('heading', { level: 2, name: /^Freeze approved · / })).toBeVisible({
    timeout: 15_000,
  })

  // Ada overturns: the freeze is cancelled with it.
  const overturn = adaRuling.getByRole('button', { name: /^Overturn \(admin\) until / })
  await expect(overturn).toBeVisible()
  await overturn.click()
  await expect(adaRuling.getByRole('heading', { level: 2 })).toHaveText(
    "Overturned by you · Ben's Grocery run is back.",
  )
  const card = page.locator('article[data-kind="freeze-vote"]')
  // The visible line (the card's polite status also announces it once, off screen).
  await expect(
    card.locator('p:not([role="status"])', {
      hasText: /^Cancelled · the check-in counts again$/,
    }),
  ).toBeVisible({ timeout: 15_000 })
  await expect(card).toHaveAttribute('data-vote-state', 'cancelled')
  await expect(result).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 2, name: /^Freeze approved · / })).toHaveCount(0)

  // Ben's Today: done, not frozen.
  await tab(ben, 'Today').click()
  await ben.reload()
  const row = dueRow(ben, 'Grocery run')
  await expect(row).toHaveAttribute('data-done', '', { timeout: 15_000 })
  await expect(row).not.toHaveAttribute('data-frozen', '')
  await expect(row.getByText(/^Frozen · /)).toHaveCount(0)
})
