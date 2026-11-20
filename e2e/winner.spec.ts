import { execFileSync } from 'node:child_process'
import { expect, test } from './support/fixtures'
import { createFirstGroup, readInviteCode, signUp, tab } from './support/members'
import { addTaskToday } from './support/plan'

/** Runs SQL against the local stack's database, failing the test on the first error. */
function psql(dbUrl: string, ...commands: string[]): string {
  return execFileSync(
    'psql',
    [dbUrl, '-At', '-v', 'ON_ERROR_STOP=1', ...commands.flatMap((command) => ['-c', command])],
    { stdio: 'pipe', encoding: 'utf8' },
  ).trim()
}

/**
 * Story 4.5 against the local stack (psql via DB_URL; CI exports it; skipped without it). Ada and
 * Ben each plan a task; psql copies both into last week, checks Ada's in, and locks last week
 * under the tick's advisory lock: Ada wins on 100, Ben has 0. Ada's next open shows the Winner card
 * ("Last week's winner", "Nice"), then the Feed's winner sticky; after a reload it stays away. Ben
 * gets "Fine." and the tease; Esc closes it; the deep link /winner/{week}?g= shows it again and
 * closing it opens the Feed.
 */
test('the weekly winner gets a card once, a Feed sticky, and a deep link', async ({
  page,
  newPhone,
}) => {
  const dbUrl = process.env.DB_URL
  test.skip(!dbUrl, 'needs DB_URL (the local stack database; CI exports it)')

  await signUp(page, { name: 'Ada' })
  const groupId = await createFirstGroup(page, 'Winner Club')
  const code = await readInviteCode(page)
  await addTaskToday(page, 'Grocery run')

  const ben = await newPhone()
  await signUp(ben, { name: 'Ben', start: `/join/${code}` })
  await ben.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(ben).toHaveURL(/\/today\?g=/)
  await addTaskToday(ben, 'Errand one')

  const lastWeek = `(select s.week_start - 7 from public.sessions s
                     where s.group_id = '${groupId}' order by s.week_start desc limit 1)`
  const week = psql(dbUrl as string, `select ${lastWeek};`)
  expect(week).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  psql(
    dbUrl as string,
    `insert into public.sessions
       (group_id, membership_id, user_id, commitment_id, week_start, slot, starts_at, ends_at)
     select s.group_id, s.membership_id, s.user_id, s.commitment_id, s.week_start - 7, s.slot,
            s.starts_at - interval '7 days', s.ends_at - interval '7 days'
     from public.sessions s
     where s.group_id = '${groupId}';`,
    // Both joined seconds ago; the lock just in the past must come after their joins.
    `update public.memberships set joined_at = joined_at - interval '1 hour'
     where group_id = '${groupId}';`,
    `insert into public.checkins
       (id, group_id, user_id, commitment_id, session_id, captured_at, received_at, counted_at, is_late)
     select gen_random_uuid(), s.group_id, s.user_id, s.commitment_id, s.id,
            s.starts_at + interval '1 hour', s.starts_at + interval '1 hour',
            s.starts_at + interval '1 hour', false
     from public.sessions s
     join public.profiles p on p.id = s.user_id
     where s.group_id = '${groupId}' and s.week_start = '${week}' and p.display_name = 'Ada';`,
    `insert into public.group_weeks (group_id, week_start, lock_at)
     values ('${groupId}', '${week}', now() - interval '1 second')
     on conflict (group_id, week_start) do update set lock_at = excluded.lock_at;`,
    // Step 5 under the tick's advisory lock (if cron locked the week first, this finds nothing).
    `select pg_advisory_xact_lock(hashtext('proofy.tick'));
     do $$ declare e text := private.lock_due_weeks(); begin
       if e is not null then raise exception '%', e; end if; end $$;`,
  )

  // Ada, the winner: the card on her next open.
  await page.reload()
  const adaCard = page.getByRole('dialog', { name: "Last week's winner" })
  await expect(adaCard).toBeVisible()
  await expect(adaCard.getByRole('heading', { name: "Last week's winner" })).toBeFocused()
  await expect(
    adaCard.getByRole('list', { name: "Last week's podium" }).getByRole('listitem').first(),
  ).toContainText('Ada, rank 1, weekly winner, 100 weekly points.')
  await expect(adaCard.getByText('Top of the board. Enjoy it while it lasts.')).toBeVisible()
  await adaCard.getByRole('button', { name: 'Nice' }).click()
  await expect(adaCard).toBeHidden()

  await tab(page, 'Feed').click()
  const sticky = page.locator('article[data-kind="weekly_winner"]')
  await expect(sticky.getByRole('heading', { level: 2 })).toHaveText(
    "Last week's winner · Ada · 100.",
  )
  await expect(sticky.getByText('Weekly winner', { exact: true })).toBeVisible()

  // Seen on this device: a reload shows no card.
  const read = page.waitForResponse((response) => response.url().includes('get_winner_week'))
  await page.reload()
  await read
  await expect(page.getByRole('heading', { level: 1, name: /^Feed/ })).toBeVisible()
  // Give React a moment to draw a card it should not draw, then check.
  await page.waitForTimeout(500)
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Ben: "Fine." and the tease; Esc closes it.
  await ben.reload()
  const benCard = ben.getByRole('dialog', { name: "Last week's winner" })
  await expect(benCard).toBeVisible()
  await expect(benCard.getByText('Bow down. Or just beat Ada.')).toBeVisible()
  await expect(benCard.getByRole('button', { name: 'Fine.' })).toBeVisible()
  await ben.keyboard.press('Escape')
  await expect(benCard).toBeHidden()

  // The deep link shows it again, even though it was seen; closing it opens the Feed.
  await ben.goto(`/winner/${week}?g=${groupId}`)
  await expect(benCard).toBeVisible()
  await benCard.getByRole('button', { name: 'Fine.' }).click()
  await expect(benCard).toBeHidden()
  await expect(ben).toHaveURL(new RegExp(`/feed\\?g=${groupId}$`))
  await expect(
    ben.locator('article[data-kind="weekly_winner"]').getByRole('heading', { level: 2 }),
  ).toHaveText("Last week's winner · Ada · 100 · Bow down. Or just beat Ada.")
  // The Feed replaced the deep link in history: back goes to Today, not to the card again.
  await ben.goBack()
  await expect(ben).toHaveURL(/\/today\?g=/)
  await expect(benCard).toBeHidden()

  // System back closes a deep-linked card the same way: the Feed, then Today.
  await ben.goto(`/winner/${week}?g=${groupId}`)
  await expect(benCard).toBeVisible()
  await ben.goBack()
  await expect(benCard).toBeHidden()
  await expect(ben).toHaveURL(new RegExp(`/feed\\?g=${groupId}$`))
  await ben.goBack()
  await expect(ben).toHaveURL(/\/today\?g=/)
  await expect(benCard).toBeHidden()
})
