import { test as base, type BrowserContext, type Page } from '@playwright/test'
import { BASE_URL, PHONE } from './phone'

interface Fixtures {
  /**
   * Opens another member's phone: a fresh browser context (own storage, own session) with the same
   * device profile as the default `page`. Closed when the test ends.
   */
  newPhone: () => Promise<Page>
}

export const test = base.extend<Fixtures>({
  newPhone: async ({ browser }, provide) => {
    const contexts: BrowserContext[] = []
    await provide(async () => {
      const context = await browser.newContext({ ...PHONE, baseURL: BASE_URL })
      contexts.push(context)
      return context.newPage()
    })
    await Promise.all(contexts.map((context) => context.close()))
  },
})

export { expect } from '@playwright/test'
