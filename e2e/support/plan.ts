import { expect, type Locator, type Page } from '@playwright/test'

/** Today's row of a habit or task, found by its title. */
export function dueRow(page: Page, title: string): Locator {
  return page.locator('[data-component="due-row"]', {
    has: page.getByRole('heading', { level: 3, name: title, exact: true }),
  })
}

/** A task due today, added from Today's "+ Add". */
export async function addTaskToday(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Add a habit or task' }).click()
  const sheet = page.getByRole('dialog', { name: 'Add a habit or task' })
  await sheet.getByRole('radio', { name: 'Task' }).click()
  // Once the group has used Groceries it is listed twice (the group's activities, then the presets).
  await sheet.getByRole('radio', { name: 'Groceries' }).first().click()
  await sheet.getByRole('textbox', { name: 'Name' }).fill(name)
  await sheet.getByRole('radio', { name: 'Today' }).click()
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(sheet).toBeHidden()
}

/** Checks in a row's task with the fake camera and waits for the camera to close. */
export async function checkIn(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: `Check in ${name}` }).click()
  const camera = page.getByRole('dialog', { name: 'Camera' })
  await camera.getByRole('button', { name: 'Take photo' }).click()
  await camera.getByRole('button', { name: 'Post' }).click()
  await expect(camera).toBeHidden({ timeout: 30_000 })
}
