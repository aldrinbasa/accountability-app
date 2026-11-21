import { execFileSync } from 'node:child_process'
import type { Page } from '@playwright/test'
import { expect, test } from './support/fixtures'
import { createFirstGroup, signUp, tab } from './support/members'

/**
 * Story 3.5 against the local stack.
 * - Friends today: a post leads the strip on Today as a mini, the mini opens the Photo viewer, and
 *   See all opens the Feed.
 * - A real miss: a task's session is moved into the past with psql (DB_URL, the local stack's
 *   database; CI exports it), tick step 4 runs, and the Feed shows the miss sticky. Skipped without
 *   DB_URL.
 */

const TEASES =
  /(The couch wins this round\.|The couch sends its regards\.|The couch is getting comfortable\.|The couch says thanks for visiting\.|Next time, the couch loses\.)$/

async function addTaskDueToday(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Add a habit or task' }).click()
  const sheet = page.getByRole('dialog', { name: 'Add a habit or task' })
  await sheet.getByRole('radio', { name: 'Task' }).click()
  await sheet.getByRole('radio', { name: 'Groceries' }).click()
  await sheet.getByRole('textbox', { name: 'Name' }).fill(name)
  await sheet.getByRole('radio', { name: 'Today' }).click()
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(sheet).toBeHidden()
}

test('a post leads Friends today; its mini opens the viewer; See all opens the Feed', async ({
  page,
}) => {
  await signUp(page, { name: 'Ada' })
  await createFirstGroup(page, 'Strip Crew')
  await addTaskDueToday(page, 'Grocery run')

  await page.getByRole('button', { name: 'Check in Grocery run' }).click()
  const camera = page.getByRole('dialog', { name: 'Camera' })
  await camera.getByRole('button', { name: 'Take photo' }).click()
  await camera.getByRole('textbox', { name: 'Caption' }).fill('milk, eggs, done')
  await camera.getByRole('button', { name: 'Post' }).click()
  await expect(camera).toBeHidden({ timeout: 30_000 })

  // The post's mini leads the strip and takes focus.
  const strip = page.locator('[data-component="friends-today"]')
  await expect(
    strip.getByRole('heading', { level: 2, name: 'Friends today · 1 posted' }),
  ).toBeVisible()
  const mini = strip.locator('[data-component="post-moment"]')
  await expect(mini).toBeFocused()
  await expect(mini).toHaveText('You · Grocery run')

  // Once the server list has it, the mini opens the Photo viewer (360 rendition).
  const serverMini = strip.getByRole('button', {
    name: /^Your Grocery run check-in, \d\d:\d\d, caption: milk, eggs, done$/,
  })
  await expect(serverMini).toBeVisible({ timeout: 15_000 })
  await expect(serverMini.locator('img')).toHaveAttribute(
    'src',
    /\/storage\/v1\/object\/sign\/checkins\/.+\/360\.webp\?token=/,
  )
  await serverMini.click()
  const viewer = page.getByRole('dialog', { name: /^You · Grocery run · \d\d:\d\d$/ })
  await expect(viewer).toBeVisible()
  await expect(viewer.getByText('milk, eggs, done')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(viewer).toBeHidden()
  await expect(serverMini).toBeFocused()

  await strip.getByRole('link', { name: 'See all in Feed' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Feed · Strip Crew' })).toBeVisible()
})

test('a task that ends without a check-in shows a miss sticky on the Feed', async ({ page }) => {
  const dbUrl = process.env.DB_URL
  test.skip(!dbUrl, 'needs DB_URL (the local stack database; CI exports it)')

  await signUp(page, { name: 'Bea' })
  const groupId = await createFirstGroup(page, 'Couch Crew')
  await addTaskDueToday(page, 'Tax forms')

  // The task's session ends a minute ago; step 4 stamps it and writes the miss event.
  execFileSync(
    'psql',
    [
      dbUrl as string,
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `update public.sessions set starts_at = now() - interval '2 days', ends_at = now() - interval '1 minute'
       where commitment_id in (select c.id from public.commitments c
                               where c.group_id = '${groupId}' and c.name = 'Tax forms');`,
      '-c',
      // Step 4 reports a failure by returning it; raise it so ON_ERROR_STOP fails the test here.
      "do $$ declare e text := private.tick_step_4_misses(); begin if e is not null then raise exception '%', e; end if; end $$;",
    ],
    { stdio: 'pipe' },
  )

  await tab(page, 'Feed').click()
  await expect(page.getByRole('heading', { level: 1, name: 'Feed · Couch Crew' })).toBeVisible()
  const sticky = page.getByRole('article').filter({ has: page.getByText('Miss', { exact: true }) })
  await expect(sticky).toBeVisible()
  await expect(sticky.getByRole('heading', { level: 2 })).toHaveText(
    new RegExp(`^You missed Tax forms\\. ${TEASES.source}`),
  )
  // No toast for a miss.
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
})
