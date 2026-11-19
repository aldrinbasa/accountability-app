import { useEffect, useId, useReducer, useRef, useState, type ReactNode } from 'react'
import {
  copyFailedText,
  copyLinkFailedText,
  GROUP_MEMBER_MAX,
  INVITE_COPY,
  inviteExpired,
  inviteExpiryText,
  inviteUrl,
  spelledCode,
  type MyGroup,
} from '@/domain/groups'
import { useInvite, useNewInvite } from '@/data/groups'
import { Button } from '@/ui/button'
import { InlineRetry } from '@/ui/inline-retry'
import { showToast } from '@/ui/toast'

async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function isAbort(error: unknown): boolean {
  // DOMException is not an Error subclass everywhere, so check the name only.
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  )
}

/** Re-renders once `expiresAt` passes, so a shown invite turns expired in place. */
function useExpired(expiresAt: string | undefined): boolean {
  const [, tick] = useReducer((n: number) => n + 1, 0)
  const expired = expiresAt === undefined ? false : inviteExpired(expiresAt, Date.now())

  useEffect(() => {
    if (expiresAt === undefined || expired) return
    const wait = Date.parse(expiresAt) - Date.now()
    // setTimeout caps at 2^31-1 ms (~24.8 days); an invite lasts 7.
    const timer = setTimeout(tick, Math.min(Math.max(wait, 0) + 50, 2_147_483_647))
    return () => clearTimeout(timer)
  }, [expiresAt, expired])

  return expired
}

function PanelFrame({ children }: { children: ReactNode }) {
  const headingId = useId()
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-wob border-[2.5px] border-line bg-card p-3 shadow-ink"
      data-component="invite-panel"
    >
      <h2 id={headingId} className="type-label tracking-[0.08em] text-muted uppercase">
        {INVITE_COPY.kicker}
      </h2>
      {children}
    </section>
  )
}

/**
 * The admin's Invite panel (on Today's waiting Empty state and in group settings). Calls
 * `create_invite` and shows the code, its expiry, coral "Share link" and secondary "Copy code". An
 * invite that expires while shown turns struck through with "Make a new one". A full group shows
 * "Group's full. 10 is the max." without asking the server. Members who are not admin see nothing.
 */
export function InvitePanel({ group }: { group: MyGroup }) {
  const isAdmin = group.role === 'admin'
  const full = group.memberCount >= GROUP_MEMBER_MAX
  const query = useInvite(group.id, isAdmin && !full)
  const newInvite = useNewInvite(group.id)
  const [newFailed, setNewFailed] = useState(false)
  const busyRef = useRef(false)
  const invite = query.data
  const expired = useExpired(invite?.expiresAt)

  if (!isAdmin) return null

  if (full) {
    return (
      <PanelFrame>
        <p className="type-body">{INVITE_COPY.full}</p>
      </PanelFrame>
    )
  }

  if (!invite) {
    return (
      <PanelFrame>
        <p className="-mt-2 type-meta text-muted">{INVITE_COPY.meta}</p>
        {query.isError ? (
          <InlineRetry onRetry={() => void query.refetch()} retryLabel={INVITE_COPY.retry}>
            {INVITE_COPY.loadFailed}
          </InlineRetry>
        ) : null}
      </PanelFrame>
    )
  }

  const code = invite.code

  async function makeNew() {
    if (busyRef.current) return
    busyRef.current = true
    setNewFailed(false)
    try {
      await newInvite.mutateAsync()
    } catch {
      setNewFailed(true)
    } finally {
      busyRef.current = false
    }
  }

  async function share() {
    const url = inviteUrl(window.location.origin, code)
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ url })
        return
      } catch (error) {
        if (isAbort(error)) return
        // Share refused for another reason (e.g. not allowed here): fall back to copying the link.
      }
    }
    if (await copyText(url)) showToast(INVITE_COPY.linkCopied)
    else showToast(copyLinkFailedText(url), { variant: 'error' })
  }

  async function copyCode() {
    if (await copyText(code)) showToast(INVITE_COPY.codeCopied)
    else showToast(copyFailedText(code), { variant: 'error' })
  }

  if (expired) {
    return (
      <PanelFrame>
        <p className="type-numeral-md tracking-[0.28em] text-muted">
          <span className="sr-only">{`Expired code ${spelledCode(code)}`}</span>
          <s aria-hidden="true" className="decoration-[3px]">
            {code}
          </s>
        </p>
        <p className="type-body">{INVITE_COPY.expired}</p>
        {newFailed ? (
          <InlineRetry onRetry={() => void makeNew()} retryLabel={INVITE_COPY.retry}>
            {INVITE_COPY.newFailed}
          </InlineRetry>
        ) : null}
        <Button
          variant="secondary"
          fullWidth
          busy={newInvite.isPending}
          busyLabel={INVITE_COPY.making}
          onClick={() => void makeNew()}
        >
          {INVITE_COPY.makeNew}
        </Button>
      </PanelFrame>
    )
  }

  return (
    <PanelFrame>
      <p className="-mt-2 type-meta text-muted">{INVITE_COPY.meta}</p>
      <p className="type-numeral-md tracking-[0.28em] tabular-nums">
        <span className="sr-only">{`Invite code ${spelledCode(code)}`}</span>
        <span aria-hidden="true" className="select-text">
          {code}
        </span>
      </p>
      <p className="-mt-1 type-meta text-muted">{inviteExpiryText(invite.expiresAt)}</p>
      <div className="grid grid-cols-2 gap-2.5">
        <Button variant="primary" onClick={() => void share()}>
          {INVITE_COPY.shareLink}
        </Button>
        <Button variant="secondary" onClick={() => void copyCode()}>
          {INVITE_COPY.copyCode}
        </Button>
      </div>
    </PanelFrame>
  )
}
