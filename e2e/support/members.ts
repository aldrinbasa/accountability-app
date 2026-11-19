import { randomUUID } from 'node:crypto'
import { expect, type Locator, type Page } from '@playwright/test'
import { readSignInCode } from './mailpit'

/** A fresh address per member, so tests stay independent and the 30 s resend limit never bites. */
export function uniqueEmail(): string {
  return `e2e-${randomUUID().replaceAll('-', '').slice(0, 16)}@example.test`
}

export interface SignUpOptions {
  /** Display name typed on Setup. */
  name: string
  /** Where the signed-out member starts; the auth gate brings them back here after Setup. */
  start?: string
  email?: string
}

/**
 * A brand-new member through the real UI: open `start` signed out, request a code, read it from
 * Mailpit, type it, see the install guide, continue without installing, set a display name. Ends
 * wherever the app forwards after Setup (the pending `next` path, else Today); callers assert that.
 */
export async function signUp(page: Page, options: SignUpOptions): Promise<string> {
  const email = options.email ?? uniqueEmail()
  await page.goto(options.start ?? '/today')
  await expect(page.getByRole('heading', { name: 'Sign in to Proofy' })).toBeVisible()
  await expect(page).toHaveURL(/\/signin$/)

  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByRole('button', { name: 'Send code' }).click()
  await expect(page.getByRole('heading', { name: 'Check your email.' })).toBeVisible()

  const code = await readSignInCode(page.request, email)
  // Six digits verify on their own.
  await page.getByLabel('6-digit code').fill(code)

  await expect(page.getByRole('heading', { name: 'Put Proofy on your home screen' })).toBeVisible()
  await expect(page).toHaveURL(/\/install$/)
  await page.getByRole('button', { name: 'Continue without installing' }).click()

  await expect(page.getByRole('heading', { name: 'What do your friends call you?' })).toBeVisible()
  await page.getByLabel('Display name').fill(options.name)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page).not.toHaveURL(/\/setup$/)
  return email
}

/** The top-bar group switcher ("Group: {name}, switch group"). */
export function switcher(page: Page): Locator {
  return page.getByRole('button', { name: /^Group: .+, switch group$/ })
}

export function switcherName(groupName: string): string {
  return `Group: ${groupName}, switch group`
}

/** The `?g=` of the current URL (fails the test when there is none). */
export function groupIdFromUrl(page: Page): string {
  const id = new URL(page.url()).searchParams.get('g')
  expect(id, `?g= in ${page.url()}`).toBeTruthy()
  return id as string
}

/** Today with no groups: create the first one and wait for the waiting state. Returns its id. */
export async function createFirstGroup(page: Page, name: string): Promise<string> {
  await expect(page.getByRole('heading', { name: 'Start a group' })).toBeVisible()
  await page.getByLabel('Group name').fill(name)
  await page.getByRole('button', { name: 'Create a group' }).click()
  await expect(page.getByText('Just you in here so far.')).toBeVisible()
  await expect(switcher(page)).toHaveAccessibleName(switcherName(name))
  await expect(page).toHaveURL(/[?&]g=[0-9a-f-]{36}/)
  return groupIdFromUrl(page)
}

/** The code on the admin's Invite panel, read from its screen-reader text ("Invite code K 7 Q X 2 M"). */
export async function readInviteCode(page: Page): Promise<string> {
  const spoken = page.getByText(/^Invite code [A-Z0-9]( [A-Z0-9]){5}$/)
  await expect(spoken).toHaveCount(1)
  const text = (await spoken.textContent()) ?? ''
  return text.replace('Invite code', '').replaceAll(' ', '')
}

/** A bottom-nav tab link. */
export function tab(page: Page, label: 'Today' | 'Feed' | 'Board' | 'Me'): Locator {
  return page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: label })
}

/** Me > My groups > {group}: the group settings screen. */
export async function openGroupSettings(page: Page, groupName: string): Promise<void> {
  await tab(page, 'Me').click()
  await expect(page.getByRole('heading', { name: 'My groups' })).toBeVisible()
  await page.getByRole('link', { name: new RegExp(escapeRegExp(groupName)) }).click()
  await expect(page.getByRole('heading', { level: 1, name: groupName })).toBeVisible()
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Today's install Hint (Android and desktop; iOS Safari gets the Banner instead). */
export const INSTALL_HINT = 'Proofy works best from your home screen. Full screen, one tap away.'
