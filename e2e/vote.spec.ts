import { execFileSync } from 'node:child_process'
import { expect, test } from './support/fixtures'
import { createFirstGroup, readInviteCode, signUp, tab } from './support/members'
import { addTaskToday, checkIn } from './support/plan'

/**
 * Story 5.2 against the local stack, in a group of three: Ada posts her task; Ben challenges it, so
 * a lavender Vote card joins the Feed. Cy votes Counts (toast with Undo, "You said it counts · 2 of 2
 * voted"), undoes it, then votes Doesn't count; Ben's card shows the locked line. With DB_URL the challenge
 * is closed by tick step 3, and Cy's card shows the ruling.
 */
test('a member votes on a challenge, undoes it and votes again', async ({ page, newPhone }) => {
  await signUp(page, { name: 'Ada' })
  const groupId = await createFirstGroup(page, 'Vote Crew')
  const code = await readInviteCode(page)

  const ben = await newPhone()
  await signUp(ben, { name: 'Ben', start: `/join/${code}` })
  await ben.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(ben).toHaveURL(/\/today\?g=/)

  const cy = await newPhone()
  await signUp(cy, { name: 'Cy', start: `/join/${code}` })
  await cy.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(cy).toHaveURL(/\/today\?g=/)

  // Ada and Ben see all three members (Today not waiting; Ben gets the 3+ challenge copy).
  await page.reload()
  await ben.reload()
  await addTaskToday(page, 'Grocery run')
  await checkIn(page, 'Grocery run')
  await expect(page.getByRole('button', { name: 'Check in Grocery run' })).toHaveCount(0)

  // Ben challenges Ada's polaroid: the vote copy and "Question it".
  await tab(ben, 'Feed').click()
  const overflow = ben.getByRole('button', { name: "More actions for Ada's Grocery run check-in" })
  await expect(overflow).toBeVisible({ timeout: 15_000 })
  await overflow.click()
  await ben
    .getByRole('dialog', { name: "Ada's Grocery run check-in" })
    .getByRole('button', { name: 'Question it', exact: true })
    .click()
  const confirm = ben.getByRole('dialog', { name: "Question Ada's Grocery run?" })
  await expect(confirm.getByText(/This casts your vote: doesn't count\./)).toBeVisible()
  await confirm.getByRole('button', { name: 'Question it', exact: true }).click()
  await expect(confirm).toBeHidden()

  const benCard = ben.locator('article[data-kind="vote"]')
  await expect(benCard.getByText("You flagged it · your vote: doesn't count")).toBeVisible()
  await expect(benCard.getByText("You questioned Ada's Grocery run check-in.")).toBeVisible()

  // Cy: the open card.
  await tab(cy, 'Feed').click()
  const card = cy.locator('article[data-kind="vote"]')
  await expect(card.getByText("Ben questioned Ada's Grocery run check-in.")).toBeVisible({
    timeout: 15_000,
  })
  await expect(card.getByText(/^QUESTION · \d+ H LEFT$/)).toBeVisible()
  await expect(card.getByRole('heading', { level: 3, name: 'Does this count?' })).toBeVisible()
  await expect(card.getByText("If nobody else votes, it doesn't count.")).toBeVisible()
  await expect(card.getByText('1 of 2 voted')).toBeVisible()
  await expect(
    card.getByRole('button', { name: "View Ada's Grocery run check-in photo" }),
  ).toBeVisible()

  // Counts, then Undo inside the 5 s window.
  await card.getByRole('button', { name: 'Vote: counts', exact: true }).click()
  await expect(card.getByText('You said it counts · 2 of 2 voted')).toBeVisible()
  await expect(card.getByRole('button', { name: 'Vote: counts', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  const toast = cy.locator('[data-sonner-toast]')
  await expect(toast.getByText('You said it counts', { exact: true })).toBeVisible()
  await toast.getByRole('button', { name: 'Undo' }).click()
  await expect(card.getByRole('button', { name: 'Vote: counts', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await expect(card.getByRole('status')).toHaveText('Vote undone.')
  await expect(card.getByText('1 of 2 voted')).toBeVisible()

  // Ben still sees the locked line (and never Cy's ballot). Checked before the last ballot: once
  // every voter has one, the minute tick may close the vote 6 s later.
  await ben.reload()
  await expect(benCard.getByText("You flagged it · your vote: doesn't count")).toBeVisible()
  await expect(benCard.getByRole('button', { name: /^Vote: / })).toHaveCount(0)

  // Doesn't count, and let it stand.
  await card.getByRole('button', { name: "Vote: doesn't count", exact: true }).click()
  await expect(card.getByText("You said it doesn't count · 2 of 2 voted")).toBeVisible()

  const dbUrl = process.env.DB_URL
  if (!dbUrl) return

  // Close it now: Cy's ballot made final (cast 10 s earlier), then tick step 3.
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
      `update public.challenges set early_close_at = now()
       where group_id = '${groupId}' and closed_at is null;`,
      '-c',
      // Step 3 reports a failure by returning it; raise it so ON_ERROR_STOP fails the test here.
      "do $$ declare e text := private.tick_step_3_close_votes(); begin if e is not null then raise exception '%', e; end if; end $$;",
    ],
    { stdio: 'pipe' },
  )

  await cy.reload()
  await expect(
    // .first(): the card's polite status may hold the same line (a ruling seen arriving).
    card
      .getByText("Didn't count · Ada's Grocery run · 2 said it doesn't count, 0 said it counts.")
      .first(),
  ).toBeVisible({
    timeout: 15_000,
  })
  await expect(card.getByText('QUESTION', { exact: true })).toBeVisible()
  // The photo is hidden on a Fake ruling: no thumbnail, no buttons.
  await expect(card.getByRole('button')).toHaveCount(0)
})
