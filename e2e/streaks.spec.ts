import { execFileSync } from 'node:child_process'
import type { Page } from '@playwright/test'
import { expect, test } from './support/fixtures'
import { createFirstGroup, signUp } from './support/members'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** The schedule meta under a Today row's title. */
function rowMeta(page: Page, title: string) {
  return page
    .getByRole('heading', { level: 3, name: title, exact: true })
    .locator('xpath=following-sibling::p')
}

/**
 * Story 4.2 against the local stack. A new commitment starts next Monday, so the run is made with
 * psql (DB_URL, the local stack's database; CI exports it): Gym every day moves its first week back
 * to last Monday, tick step 1 writes its sessions, and the two latest ended sessions get check-ins.
 * Today's row reads "… · streak 2"; a post keeps today's session and the row reads
 * "… · Done · streak 3". Skipped without DB_URL.
 */
test('a run of kept sessions shows as a streak on Today and grows with a post', async ({
  page,
}) => {
  const dbUrl = process.env.DB_URL
  test.skip(!dbUrl, 'needs DB_URL (the local stack database; CI exports it)')

  await signUp(page, { name: 'Sia' })
  const groupId = await createFirstGroup(page, 'Streak Crew')

  // Gym, fixed days, every day (starts next Monday).
  await page.getByRole('button', { name: 'Add a habit or task' }).click()
  const sheet = page.getByRole('dialog', { name: 'Add a habit or task' })
  await sheet.getByRole('radio', { name: 'Gym', exact: true }).first().click()
  const days = sheet.getByRole('group', { name: 'Days' })
  for (const day of DAYS) await days.getByRole('button', { name: day, exact: true }).click()
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(sheet).toBeHidden()

  const gym = `select c.id from public.commitments c where c.group_id = '${groupId}' and c.kind = 'commitment'`
  execFileSync(
    'psql',
    [
      dbUrl as string,
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `update public.commitment_versions set effective_week_start = effective_week_start - 14
       where commitment_id in (${gym});`,
      '-c',
      // Step 1 reports a failure by returning it; raise it so ON_ERROR_STOP fails the test here.
      "do $$ declare e text := private.tick_step_1_sessions(); begin if e is not null then raise exception '%', e; end if; end $$;",
      '-c',
      `insert into public.checkins
         (id, group_id, user_id, commitment_id, session_id, captured_at, received_at, counted_at, is_late)
       select gen_random_uuid(), s.group_id, s.user_id, s.commitment_id, s.id,
              s.starts_at + interval '1 hour', s.starts_at + interval '1 hour',
              s.starts_at + interval '1 hour', false
       from (select * from public.sessions
             where commitment_id in (${gym}) and ends_at <= now()
             order by starts_at desc limit 2) s;`,
    ],
    { stdio: 'pipe' },
  )

  await page.reload()
  const dueToday = page.getByRole('region', { name: /^Due today/ })
  await expect(dueToday.getByRole('heading', { level: 3, name: 'Gym', exact: true })).toBeVisible()
  await expect(rowMeta(page, 'Gym')).toHaveText(
    /^Fixed days · Mon Tue Wed Thu Fri Sat Sun · streak 2$/,
  )

  // Today's post keeps the run going.
  await page.getByRole('button', { name: 'Check in Gym' }).click()
  const camera = page.getByRole('dialog', { name: 'Camera' })
  await camera.getByRole('button', { name: 'Take photo' }).click()
  await camera.getByRole('button', { name: 'Post' }).click()
  await expect(camera).toBeHidden({ timeout: 30_000 })
  await expect(rowMeta(page, 'Gym')).toHaveText(
    /^Fixed days · Mon Tue Wed Thu Fri Sat Sun · Done · streak 3$/,
  )
})
