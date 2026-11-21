import { execFileSync } from 'node:child_process'
import { expect, test } from './support/fixtures'
import { createFirstGroup, readInviteCode, signUp, tab } from './support/members'
import { addTaskToday, checkIn } from './support/plan'

/**
 * Story 5.2 against the local stack, in a group of three: Ada posts her task; Ben challenges it, so
 * a lavender Vote card joins the Feed. Cy votes Real (toast with Undo, "You voted Real · 2 of 2
 * voted"), undoes it, then votes Fake; Ben's card shows the locked line. With DB_URL the challenge
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

  // Ben challenges Ada's polaroid: the vote copy and "Challenge".
  await tab(ben, 'Feed').click()
  const overflow = ben.getByRole('button', { name: "More actions for Ada's Grocery run check-in" })
  await expect(overflow).toBeVisible({ timeout: 15_000 })
  await overflow.click()
  await ben
    .getByRole('dialog', { name: "Ada's Grocery run check-in" })
    .getByRole('button', { name: 'Challenge' })
    .click()
  const confirm = ben.getByRole('dialog', { name: "Challenge Ada's Grocery run?" })
  await expect(confirm.getByText(/Your challenge counts as a Fake vote\./)).toBeVisible()
  await confirm.getByRole('button', { name: 'Challenge', exact: true }).click()
  await expect(confirm).toBeHidden()

  const benCard = ben.locator('article[data-kind="vote"]')
  await expect(benCard.getByText('You challenged · counts as Fake')).toBeVisible()
  await expect(benCard.getByText("You challenged Ada's Grocery run check-in.")).toBeVisible()

  // Cy: the open card.
  await tab(cy, 'Feed').click()
  const card = cy.locator('article[data-kind="vote"]')
  await expect(card.getByText("Ben challenged Ada's Grocery run check-in.")).toBeVisible({
    timeout: 15_000,
  })
  await expect(card.getByText(/^CHALLENGE · \d+ H LEFT$/)).toBeVisible()
  await expect(card.getByRole('heading', { level: 3, name: 'Fake or Real?' })).toBeVisible()
  await expect(card.getByText("If nobody else votes, it's ruled Fake.")).toBeVisible()
  await expect(card.getByText('1 of 2 voted')).toBeVisible()
  await expect(
    card.getByRole('button', { name: "View Ada's Grocery run check-in photo" }),
  ).toBeVisible()

  // Real, then Undo inside the 5 s window.
  await card.getByRole('button', { name: 'Vote Real' }).click()
  await expect(card.getByText('You voted Real · 2 of 2 voted')).toBeVisible()
  await expect(card.getByRole('button', { name: 'Vote Real' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(cy.getByText('Voted Real')).toBeVisible()
  await cy.getByRole('button', { name: 'Undo' }).click()
  await expect(card.getByRole('button', { name: 'Vote Real' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await expect(card.getByRole('status')).toHaveText('Vote undone.')
  await expect(card.getByText('1 of 2 voted')).toBeVisible()

  // Ben still sees the locked line (and never Cy's ballot). Checked before the last ballot: once
  // every voter has one, the minute tick may close the vote 6 s later.
  await ben.reload()
  await expect(benCard.getByText('You challenged · counts as Fake')).toBeVisible()
  await expect(benCard.getByRole('button', { name: /^Vote / })).toHaveCount(0)

  // Fake, and let it stand.
  await card.getByRole('button', { name: 'Vote Fake' }).click()
  await expect(card.getByText('You voted Fake · 2 of 2 voted')).toBeVisible()

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
    card.getByText("Ruled Fake · Ada's Grocery run removed. 2 Fake, 0 Real."),
  ).toBeVisible({
    timeout: 15_000,
  })
  await expect(card.getByText('CHALLENGE', { exact: true })).toBeVisible()
  // The photo is hidden on a Fake ruling: no thumbnail, no buttons.
  await expect(card.getByRole('button')).toHaveCount(0)
})
