import { execFileSync } from 'node:child_process'
import { expect, test } from './support/fixtures'
import { createFirstGroup, signUp, tab } from './support/members'
import { addTaskToday } from './support/plan'

/** Runs SQL against the local stack's database, failing the test on the first error. */
function psql(dbUrl: string, ...commands: string[]): void {
  execFileSync(
    'psql',
    [dbUrl, '-v', 'ON_ERROR_STOP=1', ...commands.flatMap((command) => ['-c', command])],
    { stdio: 'pipe' },
  )
}

/**
 * Story 4.4 against the local stack (psql via DB_URL; CI exports it; skipped without it). Ada,
 * alone in her group (a group of one keeps its results, 2026-11-20 decision), gets a copy of her
 * task in last week, missed, and last week's lock is moved 10 minutes ahead so the Board offers
 * Last week: "Locks … can still change" and 0 weekly points. Then the lock moves into the
 * past, the week is locked under the tick's advisory lock, the lock moves ahead again (so only the
 * server's `locked` flag can show "Locked"), and a check-in is written into that session straight
 * in the database (live points would now be 100). A focus refetch shows the "Locked" chip and still
 * 0 weekly points: the Board reads the frozen results.
 */
test('the Board shows a locked last week with its frozen results', async ({ page }) => {
  const dbUrl = process.env.DB_URL
  test.skip(!dbUrl, 'needs DB_URL (the local stack database; CI exports it)')

  await signUp(page, { name: 'Ada' })
  const groupId = await createFirstGroup(page, 'Lock Club')
  await addTaskToday(page, 'Grocery run')

  const lastWeek = `(select s.week_start - 7 from public.sessions s
                     where s.group_id = '${groupId}' order by s.week_start desc limit 1)`
  const lastSession = `select s.* from public.sessions s
                       where s.group_id = '${groupId}' and s.week_start = ${lastWeek}`
  psql(
    dbUrl as string,
    `insert into public.sessions
       (group_id, membership_id, user_id, commitment_id, week_start, slot, starts_at, ends_at)
     select s.group_id, s.membership_id, s.user_id, s.commitment_id, s.week_start - 7, s.slot,
            s.starts_at - interval '7 days', s.ends_at - interval '7 days'
     from public.sessions s
     where s.group_id = '${groupId}';`,
    // The test runs within seconds of sign-up; a lock just in the past must still come after the
    // join, or Ada was not a member at the lock and gets no stored row.
    `update public.memberships set joined_at = joined_at - interval '1 hour'
     where group_id = '${groupId}';`,
    `insert into public.group_weeks (group_id, week_start, lock_at)
     values ('${groupId}', ${lastWeek}, now() + interval '10 minutes')
     on conflict (group_id, week_start) do update set lock_at = excluded.lock_at;`,
  )

  await page.reload()
  await tab(page, 'Board').click()
  await page.getByRole('radio', { name: 'Last week' }).click()
  // The lock is 10 minutes ahead, so the chip shows that time, not Wed 23:59.
  await expect(page.getByText(/^Locks .* · can still change$/)).toBeVisible()
  const stand = page.locator('[data-component="solo-stand"]')
  await expect(stand).toContainText('Ada, 0 weekly points, 1 task, 1 miss last week.')

  // The lock passes and step 5 runs under the tick's advisory lock (a cron run meanwhile skips; if
  // cron locked the week first, lock_due_weeks finds nothing and the week is locked anyway).
  psql(
    dbUrl as string,
    `update public.group_weeks set lock_at = now() - interval '1 second'
     where group_id = '${groupId}' and week_start = ${lastWeek};`,
    `select pg_advisory_xact_lock(hashtext('proofy.tick'));
     do $$ declare e text := private.lock_due_weeks(); begin
       if e is not null then raise exception '%', e; end if; end $$;`,
    // The lock moves ahead again, so only the server's locked flag can make the chip read "Locked".
    `update public.group_weeks set lock_at = now() + interval '10 minutes'
     where group_id = '${groupId}' and week_start = ${lastWeek};`,
    `insert into public.checkins
       (id, group_id, user_id, commitment_id, session_id, captured_at, received_at, counted_at, is_late)
     select gen_random_uuid(), s.group_id, s.user_id, s.commitment_id, s.id,
            s.starts_at + interval '1 hour', s.starts_at + interval '1 hour',
            s.starts_at + interval '1 hour', false
     from (${lastSession}) s;`,
  )

  // Back to the app: the Board refetches on focus.
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
  await expect(page.getByText('Locked', { exact: true })).toBeVisible()
  await expect(stand).toContainText('Ada, 0 weekly points, 1 task, 1 miss last week.')
})
