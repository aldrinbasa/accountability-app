import type { MouseEvent, ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { cn } from '@/ui/lib/utils'
import { cameFromMe } from '@/features/me/pushed-from-me'
import { memberProfilePath } from '@/features/profile/pushed-from-board'

export interface ProfileLinkProps {
  userId: string
  /** The signed-in member: their own block or row opens Me instead (replacing the Board entry). */
  own: boolean
  /** The link's accessible name (the member's sentence, screen-reader text; the drawing is hidden). */
  label: string
  children: ReactNode
  className?: string
}

/**
 * A Board block or row as a link to the member profile (Story 4.6), whole area tappable (44px
 * minimum). Pushed with `fromBoard` (what sits behind the Board is kept), so back pops to the Board;
 * the member's own goes to Me like a tab switch (back to the Me entry when the Board replaced a
 * screen pushed from Me, so Me never stacks on Me). `?g=` is carried along.
 */
export function ProfileLink({ userId, own, label, children, className }: ProfileLinkProps) {
  const { search, state } = useLocation()
  const navigate = useNavigate()
  const keep = state && typeof state === 'object' ? state : {}
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!own || !cameFromMe(state)) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return
    }
    event.preventDefault()
    void navigate(-1)
  }
  return (
    <Link
      onClick={onClick}
      to={{ pathname: own ? '/me' : memberProfilePath(userId), search }}
      state={own ? state : { ...keep, fromBoard: true }}
      replace={own}
      className={cn('block min-h-target-min rounded-wob press-overlay', className)}
      data-component="profile-link"
    >
      <span className="sr-only">{label}</span>
      {children}
    </Link>
  )
}
