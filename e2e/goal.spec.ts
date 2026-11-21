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
 * Story 4.7 against the local stack (psql via DB_URL; CI exports it; skipped without it). Ada and
 * Ben each plan a task; Ada checks hers in (100 vs 0, an average of 50). Ada sets a 50% weekly goal
 * from the Board's Goal panel: the toast, the panel with Everyone's part, and Team Player pending on
 * her Me. Ben sees the panel without Edit. psql moves the goal back a week, copies both tasks into
 * last week, checks Ada's in and locks last week under the tick's advisory lock: the goal is hit, so
 * the Feed shows the goal sticky, the panel shows "Goal hit…", and both earn Team Player.
 */
test('the admin sets a group goal; the lock decides it and everyone earns Team Player', async ({
  page,
  newPhone,
}) => {
  const dbUrl = process.env.DB_URL
  test.skip(!dbUrl, 'needs DB_URL (the local stack database; CI exports it)')

  await signUp(page, { name: 'Ada' })
  const groupId = await createFirstGroup(page, 'Goal Club')
  const code = await readInviteCode(page)
  await addTaskToday(page, 'Grocery run')

  const ben = await newPhone()
  await signUp(ben, { name: 'Ben', start: `/join/${code}` })
  await ben.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(ben).toHaveURL(/\/today\?g=/)
  await addTaskToday(ben, 'Errand one')

  await checkIn(page, 'Grocery run')

  // Ada sets the goal from the Board.
  await tab(page, 'Board').click()
  const panel = page.getByRole('region', { name: /^Group goal/ })
  await panel.getByRole('button', { name: 'Set a group goal' }).click()
  const sheet = page.getByRole('dialog', { name: 'Set a group goal' })
  await expect(sheet.getByText('Average of everyone with a score.')).toBeVisible()
  for (let i = 0; i < 7; i += 1) {
    await sheet.getByRole('button', { name: 'Lower target' }).click()
  }
  await expect(sheet.getByText('50 percent')).toBeAttached()
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Goal set: 50% this week.')).toBeVisible()
  await expect(sheet).toBeHidden()
  await expect(
    page.getByRole('region', { name: 'Group goal 50% this week. Now 50%.' }),
  ).toBeVisible()
  await expect(panel.getByRole('img', { name: 'Ada, 100%' })).toBeVisible()
  await expect(panel.getByRole('img', { name: 'Ben, 0%' })).toBeVisible()

  // The live average meets the target: Team Player is pending on Me.
  await tab(page, 'Me').click()
  await expect(page.getByRole('button', { name: 'Team Player, pending' })).toBeVisible()

  // Ben sees the goal, without Edit.
  await tab(ben, 'Board').click()
  const benPanel = ben.getByRole('region', { name: /^Group goal 50% this week/ })
  await expect(benPanel.getByRole('heading', { name: 'Group goal · 50% this week' })).toBeVisible()
  await expect(benPanel.getByRole('button', { name: 'Edit' })).toHaveCount(0)

  // Last week: the goal moved back a week, both tasks copied, Ada's checked in, then locked.
  const lastWeek = `(select s.week_start - 7 from public.sessions s
                     where s.group_id = '${groupId}' order by s.week_start desc limit 1)`
  const week = psql(dbUrl as string, `select ${lastWeek};`)
  expect(week).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  psql(
    dbUrl as string,
    `update public.group_goals set effective_week_start = effective_week_start - 7
     where group_id = '${groupId}';`,
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

  // Ada: the Winner card first (Story 4.5), then the goal result on the Feed, Board and Me.
  await page.reload()
  const adaCard = page.getByRole('dialog', { name: "Last week's winner" })
  await expect(adaCard).toBeVisible()
  await adaCard.getByRole('button', { name: 'Nice' }).click()
  await expect(adaCard).toBeHidden()
  await expect(page.getByRole('button', { name: /^Team Player, earned / })).toBeVisible()
  await tab(page, 'Feed').click()
  await expect(
    page.getByRole('heading', {
      name: 'Goal hit · 50% this week. Nobody let the group down. This time.',
    }),
  ).toBeVisible()
  await tab(page, 'Board').click()
  await expect(panel.getByText('Goal hit. Nobody let the group down. This time.')).toBeVisible()

  // Ben earned it too.
  await ben.reload()
  const benCard = ben.getByRole('dialog', { name: "Last week's winner" })
  await expect(benCard).toBeVisible()
  await benCard.getByRole('button', { name: 'Fine.' }).click()
  await expect(benCard).toBeHidden()
  await tab(ben, 'Me').click()
  await expect(ben.getByRole('button', { name: /^Team Player, earned / })).toBeVisible()
})
