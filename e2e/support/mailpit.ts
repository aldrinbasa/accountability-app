import { expect, type APIRequestContext } from '@playwright/test'
import { MAILPIT_URL } from './phone'

interface MailpitSummary {
  ID: string
  Subject: string
}

interface MailpitSearch {
  messages: MailpitSummary[] | null
}

interface MailpitMessage {
  Text: string
  HTML: string
}

const CODE = /\b(\d{6})\b/

/**
 * The 6-digit sign-in code sent to `email`, read from Mailpit's HTTP API. The subject is
 * "{code} is your Proofy code"; the body is the fallback. Each test uses a fresh address, so the
 * newest message for it is the one just requested.
 */
export async function readSignInCode(request: APIRequestContext, email: string): Promise<string> {
  const query = encodeURIComponent(`to:"${email}"`)
  let latest: MailpitSummary | undefined
  await expect
    .poll(
      async () => {
        const response = await request.get(`${MAILPIT_URL}/api/v1/search?query=${query}`)
        if (!response.ok()) return 0
        const body = (await response.json()) as MailpitSearch
        latest = body.messages?.[0]
        return body.messages?.length ?? 0
      },
      { message: `sign-in email for ${email} in Mailpit`, timeout: 30_000 },
    )
    .toBeGreaterThan(0)

  const message = latest as MailpitSummary
  const fromSubject = CODE.exec(message.Subject)?.[1]
  if (fromSubject) return fromSubject

  const response = await request.get(`${MAILPIT_URL}/api/v1/message/${message.ID}`)
  expect(response.ok()).toBe(true)
  const full = (await response.json()) as MailpitMessage
  const fromBody = CODE.exec(full.Text)?.[1] ?? CODE.exec(full.HTML)?.[1]
  if (!fromBody) throw new Error(`No 6-digit code in the email to ${email}`)
  return fromBody
}
