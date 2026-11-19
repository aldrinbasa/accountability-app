import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { CloudSlash, Envelope } from '@phosphor-icons/react'
import { backendErrorCode } from '@/domain/error-codes'
import {
  adminLine,
  JOIN_COPY,
  joinExpiredText,
  joinFullText,
  joinMemberCountText,
  normalizeInviteCode,
  type InvitePreview,
} from '@/domain/groups'
import { useInvitePreview, useJoinGroup, useRefetchMyGroups } from '@/data/groups'
import { isOffline } from '@/data/connectivity'
import { Button } from '@/ui/button'
import { EmptyState } from '@/ui/empty-state'
import { Icon } from '@/ui/icon'
import { InlineRetry } from '@/ui/inline-retry'
import { useOpenGroupOnToday } from '@/features/group/use-focused-group'

/** What the screen shows besides the loaded invite. */
type Override = 'expired' | 'full' | 'unknown' | 'offline' | null

/**
 * `/join/{code}` (signed in with a profile; the auth gate brings a signed-out invitee back here
 * after sign-in, install guide and setup). Valid: the group, its admin, its member count and a
 * coral Join, which lands on `/today?g={groupId}`. Expired, full or unknown: the story line and
 * "Go to Today". Already a member: straight to `/today?g={groupId}`. Offline: a full-screen Empty
 * state with Try again; any other failure an Inline retry.
 */
export function JoinScreen() {
  const params = useParams()
  const code = normalizeInviteCode(params.code ?? '')
  const preview = useInvitePreview(code)
  const join = useJoinGroup()
  const openGroup = useOpenGroupOnToday()
  const refetchMyGroups = useRefetchMyGroups()
  const navigate = useNavigate()
  const location = useLocation()
  const [override, setOverride] = useState<Override>(null)
  const [joinFailed, setJoinFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const mounted = useRef(false)
  const [mountedAt] = useState(() => Date.now())

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // A `member` preview cached before this screen opened (an earlier join) is not trusted: the member
  // may have left or been removed since. It counts as not loaded until the refetch on mount answers.
  const staleMember = preview.data?.status === 'member' && preview.dataUpdatedAt < mountedAt
  const data = staleMember ? undefined : preview.data
  const memberGroupId = data?.status === 'member' ? data.groupId : null

  useEffect(() => {
    if (!memberGroupId || busyRef.current) return
    // Refetch first: a cached list without this group would make Today refocus another one.
    let cancelled = false
    void refetchMyGroups().then(() => {
      if (!cancelled) openGroup(memberGroupId)
    })
    return () => {
      cancelled = true
    }
  }, [memberGroupId, openGroup, refetchMyGroups])

  function goToday() {
    void navigate({ pathname: '/today', search: location.search }, { replace: true })
  }

  function tryAgain() {
    setOverride(null)
    setJoinFailed(false)
    void preview.refetch()
  }

  async function submit() {
    if (busyRef.current) return
    if (isOffline()) {
      setOverride('offline')
      return
    }
    busyRef.current = true
    setBusy(true)
    setJoinFailed(false)
    try {
      const groupId = await join.mutateAsync(code)
      if (mounted.current) openGroup(groupId)
    } catch (error) {
      busyRef.current = false
      if (!mounted.current) return
      setBusy(false)
      const failure = backendErrorCode(error)
      if (failure === 'invite_expired') setOverride('expired')
      else if (failure === 'group_full') setOverride('full')
      else if (failure === 'invite_not_found') setOverride('unknown')
      else if (failure === 'network') setOverride('offline')
      else setJoinFailed(true)
    }
  }

  const loadFailure = preview.isError ? backendErrorCode(preview.error) : null
  // A query started offline is paused by TanStack Query rather than failed.
  const offline =
    override === 'offline' ||
    (data === undefined &&
      (preview.fetchStatus === 'paused' ||
        loadFailure === 'network' ||
        (loadFailure !== null && isOffline())))

  if (offline) {
    return (
      <Centered>
        <h1 tabIndex={-1} className="sr-only">
          {JOIN_COPY.screenTitle}
        </h1>
        <EmptyState
          icon={CloudSlash}
          line={JOIN_COPY.offlineLine}
          body={JOIN_COPY.offlineBody}
          action={{ label: JOIN_COPY.tryAgain, onClick: tryAgain }}
        />
      </Centered>
    )
  }

  const unusable = unusableText(
    override ?? (loadFailure === 'invite_not_found' ? 'unknown' : null),
    data,
  )
  if (unusable) {
    return (
      <div className="flex flex-1 flex-col pt-4">
        <h1 tabIndex={-1} className="sr-only">
          {JOIN_COPY.screenTitle}
        </h1>
        <div className="my-auto flex flex-col items-center gap-2 px-2 py-[28px] text-center">
          <Icon icon={Envelope} size={64} />
          <p className="max-w-[30ch] type-body">{unusable}</p>
        </div>
        <Button variant="secondary" fullWidth onClick={goToday}>
          {JOIN_COPY.goToday}
        </Button>
      </div>
    )
  }

  if (data === undefined) {
    if (!preview.isError) return null
    return (
      <Centered>
        <h1 tabIndex={-1} className="sr-only">
          {JOIN_COPY.screenTitle}
        </h1>
        <InlineRetry onRetry={tryAgain} retryLabel={JOIN_COPY.retry}>
          {JOIN_COPY.loadFailed}
        </InlineRetry>
      </Centered>
    )
  }

  // Already a member: the effect above opens Today on the group.
  if (data.status === 'member' && !busy) return null

  return (
    <div className="flex flex-1 flex-col pt-4">
      <div className="my-auto flex flex-col gap-2">
        <p className="type-label tracking-[0.08em] text-muted uppercase">{JOIN_COPY.kicker}</p>
        <h1 tabIndex={-1} className="type-display break-words">
          {data.groupName}
        </h1>
        <p className="flex flex-col type-body">
          <span>{adminLine(data.adminName)}</span>
          <span className="text-muted">{joinMemberCountText(data.memberCount)}</span>
        </p>
      </div>
      <div className="flex flex-col gap-4">
        {joinFailed ? (
          <InlineRetry onRetry={() => void submit()} retryLabel={JOIN_COPY.retry}>
            {JOIN_COPY.joinFailed}
          </InlineRetry>
        ) : null}
        <Button
          variant="primary"
          fullWidth
          busy={busy}
          busyLabel={JOIN_COPY.joining}
          onClick={() => void submit()}
        >
          {JOIN_COPY.join}
        </Button>
      </div>
    </div>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 flex-col justify-center pt-4">{children}</div>
}

/** The story line for an invite that cannot be used, or null when it can. */
function unusableText(
  override: 'expired' | 'full' | 'unknown' | null,
  data: InvitePreview | undefined,
): string | null {
  const state =
    override ?? (data?.status === 'expired' || data?.status === 'full' ? data.status : null)
  if (state === 'unknown') return JOIN_COPY.unknown
  if (!data) return null
  if (state === 'expired') return joinExpiredText(data.adminName)
  if (state === 'full') return joinFullText(data.groupName)
  return null
}
