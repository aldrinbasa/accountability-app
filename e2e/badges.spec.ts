import { execFileSync } from 'node:child_process'
import { expect, test } from './support/fixtures'
import { createFirstGroup, readInviteCode, signUp, tab } from './support/members'
import { addTaskToday, checkIn } from './support/plan'

/** Runs SQL against the local stack's database, failing the test on the first error. */
function psql(dbUrl: string, ...commands: string[]): string {
  return execFileSync(
    'psql',
    [dbUrl, '-At', '-v', 'ON_ERROR_STOP=1', ...commands.flatMap((command) => ['-c', command])],
    { stdio: 'pipe', encoding: 'utf8' },
  ).trim()
}

/**
 * Story 4.6 against the local stack (psql via DB_URL; CI exports it; skipped without it). Ada and
 * Ben each plan a task; Ada checks hers in, so Me shows First Proof pending with the "Unlocks at
 * week lock" chip and its Sheet names the lock. psql copies both tasks into last week, checks Ada's
 * in and locks last week under the tick's advisory lock: Ada earns First Proof, Clean Sheet and the
 * Weekly Winner badge. Her Me shows them earned, the Title sticky "Couch Potato", "100 all-time
 * points in Badge Club" and the title ladder. Ben opens Ada's profile from the Board podium and sees
 * her badges; Back returns to the Board.
 */
test('badges show pending, then earned at the lock, on Me and on a friend’s profile', async ({
  page,
  newPhone,
}) => {
  const dbUrl = process.env.DB_URL
  test.skip(!dbUrl, 'needs DB_URL (the local stack database; CI exports it)')

  await signUp(page, { name: 'Ada' })
  const groupId = await createFirstGroup(page, 'Badge Club')
  const code = await readInviteCode(page)
  await addTaskToday(page, 'Grocery run')

  const ben = await newPhone()
  await signUp(ben, { name: 'Ben', start: `/join/${code}` })
  await ben.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(ben).toHaveURL(/\/today\?g=/)
  await addTaskToday(ben, 'Errand one')

  // Ada's check-in today: First Proof is pending until the week locks.
  await checkIn(page, 'Grocery run')
  await tab(page, 'Me').click()
  const firstProof = page.getByRole('button', { name: 'First Proof, pending' })
  await expect(firstProof).toBeVisible()
  await expect(firstProof.getByText('Unlocks at week lock')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Hat Trick, locked' })).toBeVisible()
  await firstProof.click()
  const pendingSheet = page.getByRole('dialog', { name: 'First Proof' })
  await expect(pendingSheet.getByText('Your first check-in')).toBeVisible()
  await expect(pendingSheet.getByText(/^Unlocks when the week locks, Wed 23:59/)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(pendingSheet).toBeHidden()

  // Last week: both tasks copied, Ada's checked in, then locked.
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
    `select pg_advisory_xact_lock(hashtext('proofy.tick'));
     do $$ declare e text := private.lock_due_weeks(); begin
       if e is not null then raise exception '%', e; end if; end $$;`,
  )

  // Ada: the Winner card first (Story 4.5), then Me with the earned badges.
  await page.reload()
  const adaCard = page.getByRole('dialog', { name: "Last week's winner" })
  await expect(adaCard).toBeVisible()
  await adaCard.getByRole('button', { name: 'Nice' }).click()
  await expect(adaCard).toBeHidden()
  await expect(
    page.getByRole('button', { name: /^First Proof, earned \d{1,2} [A-Z][a-z]{2}$/ }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: /^Clean Sheet, earned / })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Weekly Winner, earned / })).toBeVisible()
  await expect(page.getByText('100 all-time points in Badge Club')).toBeVisible()
  await page.getByRole('button', { name: 'Title: Couch Potato. Show all titles' }).click()
  const ladder = page.getByRole('dialog', { name: 'Titles' })
  await expect(ladder.locator('[aria-current="true"]')).toContainText('Couch Potato · 0 points')
  await expect(ladder.getByText('Legend · 10,000 points')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(ladder).toBeHidden()

  // Ben opens Ada's profile from the Board podium.
  await ben.reload()
  const benCard = ben.getByRole('dialog', { name: "Last week's winner" })
  await expect(benCard).toBeVisible()
  await benCard.getByRole('button', { name: 'Fine.' }).click()
  await expect(benCard).toBeHidden()
  await tab(ben, 'Board').click()
  await ben.getByRole('link', { name: /^Ada, rank 1/ }).click()
  await expect(ben).toHaveURL(new RegExp(`/board/m/[^?]+\\?g=${groupId}$`))
  await expect(ben.getByRole('heading', { level: 1, name: 'Ada' })).toBeVisible()
  await expect(ben.getByText('100 all-time points in Badge Club')).toBeVisible()
  await expect(ben.getByRole('button', { name: /^First Proof, earned / })).toBeVisible()
  await expect(ben.getByRole('button', { name: /^Weekly Winner, earned / })).toBeVisible()
  await ben.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(ben).toHaveURL(new RegExp(`/board\\?g=${groupId}$`))
})
