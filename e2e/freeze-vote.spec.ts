import { execFileSync } from 'node:child_process'
import { expect, test } from './support/fixtures'
import { createFirstGroup, readInviteCode, signUp, tab } from './support/members'
import { addTaskToday, dueRow } from './support/plan'

/**
 * Story 5.5 against the local stack, in a group of three: Ben asks to freeze his task due today.
 * Ada sees the yellow freeze Vote card in the Feed (request line, reason, rule, "0 of 2 voted") and
 * votes Approve (toast "Voted Approve", "Voted Approve · 1 of 2 voted"); Ben's card shows "Your
 * request · waiting on the group". With DB_URL the request is closed by tick step 3: Ben's Feed
 * shows "Freeze approved · … is off the plan." and his row reads "Frozen · flu, in bed".
 */
test('the group votes on a freeze request and it is approved', async ({ page, newPhone }) => {
  await signUp(page, { name: 'Ada' })
  const groupId = await createFirstGroup(page, 'Freeze Vote Crew')
  const code = await readInviteCode(page)

  const ben = await newPhone()
  await signUp(ben, { name: 'Ben', start: `/join/${code}` })
  await ben.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(ben).toHaveURL(/\/today\?g=/)

  const cy = await newPhone()
  await signUp(cy, { name: 'Cy', start: `/join/${code}` })
  await cy.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(cy).toHaveURL(/\/today\?g=/)

  // Ben requests the freeze with all three members in the group.
  await ben.reload()
  await addTaskToday(ben, 'Errand one')
  await ben.getByRole('button', { name: 'More actions for Errand one', exact: true }).click()
  await ben
    .getByRole('dialog', { name: 'Errand one', exact: true })
    .getByRole('button', { name: 'Request freeze' })
    .click()
  const sheet = ben.getByRole('dialog', { name: 'Request freeze' })
  await sheet.getByRole('textbox', { name: 'Reason' }).fill('flu, in bed')
  await sheet.getByRole('button', { name: 'Send' }).click()
  await expect(sheet).toBeHidden()
  await expect(
    ben.locator('[data-sonner-toast]').filter({ hasText: /^Freeze requested\.$/ }),
  ).toHaveCount(1)

  // Ada: the open freeze card.
  await tab(page, 'Feed').click()
  const card = page.locator('article[data-kind="freeze-vote"]')
  await expect(card.getByText(/^Ben wants Errand one on [A-Z][a-z]{2} frozen\.$/)).toBeVisible({
    timeout: 15_000,
  })
  await expect(card.getByText(/^FREEZE REQUEST · \d+ (H|MIN) LEFT$/)).toBeVisible()
  await expect(card.getByText('Reason: flu, in bed', { exact: true })).toBeAttached()
  await expect(card.getByText('No votes means approved.', { exact: true })).toBeVisible()
  await expect(card.getByText('0 of 2 voted', { exact: true })).toBeVisible()

  await card.getByRole('button', { name: 'Vote: approve', exact: true }).click()
  await expect(card.getByText('Voted Approve · 1 of 2 voted', { exact: true })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Vote: approve', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  const toast = page.locator('[data-sonner-toast]')
  await expect(toast.getByText('Voted Approve', { exact: true })).toBeVisible()
  await expect(toast.getByRole('button', { name: 'Undo' })).toBeVisible()

  // Ben: his own request is locked.
  await tab(ben, 'Feed').click()
  const benCard = ben.locator('article[data-kind="freeze-vote"]')
  await expect(
    benCard.getByText('Your request · waiting on the group', { exact: true }),
  ).toBeVisible({ timeout: 15_000 })
  await expect(benCard.getByRole('button', { name: /^Vote: / })).toHaveCount(0)

  const dbUrl = process.env.DB_URL
  if (!dbUrl) return

  // Close it now: Ada's ballot made final (cast 10 s earlier), then tick step 3.
  execFileSync(
    'psql',
    [
      dbUrl,
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `update public.votes set cast_at = cast_at - interval '10 seconds'
       where group_id = '${groupId}';`,
      '-c',
      `update public.freeze_requests set early_close_at = now()
       where group_id = '${groupId}' and closed_at is null;`,
      '-c',
      "do $$ declare e text := private.tick_step_3_close_votes(); begin if e is not null then raise exception '%', e; end if; end $$;",
    ],
    { stdio: 'pipe' },
  )

  await ben.reload()
  const result = ben.locator('article[data-kind="freeze-result"]')
  await expect(
    result.getByRole('heading', {
      level: 2,
      name: /^Freeze approved · Errand one on [A-Z][a-z]{2} is off the plan\.$/,
    }),
  ).toBeVisible({ timeout: 15_000 })
  await expect(result.getByText('Your request', { exact: true })).toBeVisible()

  await tab(ben, 'Today').click()
  const row = dueRow(ben, 'Errand one')
  await expect(row).toHaveAttribute('data-frozen', '', { timeout: 15_000 })
  await expect(row.getByText('Frozen · flu, in bed', { exact: true })).toBeVisible()
})
