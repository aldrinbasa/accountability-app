import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { ArrowLeft, CloudSlash, ListChecks, PencilSimple, Snowflake } from '@phosphor-icons/react'
import { CUSTOM_ACTIVITY_ICON, presetIcon } from '@/domain/activities'
import {
  commitmentOptions,
  freezeOptionKey,
  pendingMeta,
  planRowPending,
  requestFreezeLabel,
  type FreezeOption,
  type FreezeRequest,
} from '@/domain/freeze'
import { GROUP_COPY, isWaiting } from '@/domain/groups'
import { editLabel, MY_PLAN_COPY, myPlanIn, myPlanMeta, type MyPlanItem } from '@/domain/my-plan'
import { itemTitle } from '@/domain/today'
import { useFreezeOptions, useMyFreezes } from '@/data/freeze'
import { useCommitment, useMyPlan } from '@/data/plan'
import { EmptyState } from '@/ui/empty-state'
import { Icon } from '@/ui/icon'
import { IconButton } from '@/ui/icon-button'
import { runAfterSheetClose } from '@/ui/sheet-history'
import { Skeleton, SkeletonBar, SkeletonBlock } from '@/ui/skeleton'
import { showToast } from '@/ui/toast'
import { searchWithGroup, useFocusedGroup } from '@/features/group/use-focused-group'
import { FreezeSheet } from '@/features/freeze/freeze-sheet'
import { useMinuteClock } from '@/features/freeze/use-minute-clock'
import { cameFromMe } from '@/features/me/pushed-from-me'
import { usePlanSheet } from '@/features/plan/plan-sheet-context'
import { PlanSheetHost } from '@/features/plan/plan-sheet-host'

/**
 * `/me/plan?g={groupId}` (and `/me/plan/{commitmentId}`), pushed from Me (Story 2.6): a 44px back
 * button, one h1 "My plan", then the focused group's commitments and tasks from `get_my_plan` in
 * "Current" and "Past", each row with the server's state as its meta line and an Edit button while
 * the server says it can be edited. Without `?g=` the focused group is used.
 * The deep link opens that commitment's edit sheet over the list; closing it (any way) returns to
 * `/me/plan`. A task id, or a commitment that is gone or ended, opens My plan with the toast
 * "That's already wrapped up." A commitment of another of the member's groups switches `?g=` to
 * that group first; one of a group they are not in reads as wrapped up. System back closes an open
 * sheet first, then pops My plan.
 */
export function MyPlanScreen() {
  const { commitmentId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { group, groups, query } = useFocusedGroup()
  const headingRef = useRef<HTMLHeadingElement>(null)

  function back() {
    if (cameFromMe(location.state)) void navigate(-1)
    else void navigate({ pathname: '/me', search: location.search }, { replace: true })
  }

  /** The deep link's sheet closed: show the plain list at `/me/plan`. */
  function toList() {
    const { search, state } = location
    runAfterSheetClose(
      () => void navigate({ pathname: '/me/plan', search }, { replace: true, state }),
    )
  }

  /** The deep link's commitment belongs to another current group: show that group's plan. */
  function toGroup(groupId: string) {
    void navigate(
      { pathname: location.pathname, search: searchWithGroup(location.search, groupId) },
      { replace: true, state: location.state },
    )
  }

  /** The deep link's commitment can't be shown here: the plain list with the toast. */
  function wrappedUp() {
    showToast(MY_PLAN_COPY.wrappedUp)
    void navigate(
      { pathname: '/me/plan', search: location.search },
      { replace: true, state: location.state },
    )
  }

  const heading = (
    <h1 ref={headingRef} tabIndex={-1} className="type-headline">
      {MY_PLAN_COPY.title}
    </h1>
  )

  return (
    <div className="flex flex-col gap-stack pt-4">
      <div>
        <IconButton icon={ArrowLeft} label="Back" onClick={back} />
      </div>
      {group ? (
        <PlanSheetHost
          key={group.id}
          groupId={group.id}
          onClosed={commitmentId ? toList : undefined}
        >
          <div className="flex flex-col gap-stack">
            {heading}
            <MyPlanSections groupId={group.id} solo={isWaiting(group)} />
          </div>
          {commitmentId ? (
            <DeepLinkEdit
              commitmentId={commitmentId}
              groupId={group.id}
              groupIds={(groups ?? []).map((g) => g.id)}
              onOtherGroup={toGroup}
              onUnavailable={wrappedUp}
              opener={() => headingRef.current}
            />
          ) : null}
        </PlanSheetHost>
      ) : (
        <>
          {heading}
          {groups === undefined && query.isError ? (
            <EmptyState
              icon={CloudSlash}
              line={GROUP_COPY.loadFailedLine}
              body={GROUP_COPY.loadFailedBody}
              action={{ label: GROUP_COPY.tryAgain, onClick: () => void query.refetch() }}
            />
          ) : groups !== undefined ? (
            <EmptyState icon={ListChecks} line={MY_PLAN_COPY.emptyLine} />
          ) : null}
        </>
      )}
    </div>
  )
}

/**
 * Opens the deep link's commitment in the Plan sheet once its `get_commitment` read is in and it
 * belongs to the shown group. A commitment of another current group moves `?g=` there first (this
 * host and its query keys are the shown group's); one of a group the member is not in is
 * unavailable. A failed read opens the sheet anyway, which shows the failure (or, for not_found,
 * closes with the wrapped-up toast).
 */
function DeepLinkEdit({
  commitmentId,
  groupId,
  groupIds,
  onOtherGroup,
  onUnavailable,
  opener,
}: {
  commitmentId: string
  groupId: string
  groupIds: readonly string[]
  onOtherGroup: (groupId: string) => void
  onUnavailable: () => void
  opener: () => HTMLElement | null
}) {
  const { openPlanSheet } = usePlanSheet()
  const commitment = useCommitment(groupId, commitmentId)
  const ownGroup = commitment.data?.groupId
  const ready = ownGroup !== undefined || commitment.isError
  const handled = useRef<string | null>(null)
  const latest = useRef({ groupIds, onOtherGroup, onUnavailable, opener })
  useEffect(() => {
    latest.current = { groupIds, onOtherGroup, onUnavailable, opener }
  })
  useEffect(() => {
    if (!ready) return
    const key = `${groupId}:${commitmentId}`
    if (handled.current === key) return
    handled.current = key
    const current = latest.current
    if (ownGroup !== undefined && ownGroup !== groupId) {
      if (current.groupIds.includes(ownGroup)) current.onOtherGroup(ownGroup)
      else current.onUnavailable()
      return
    }
    openPlanSheet({ mode: 'edit', commitmentId, kind: 'commitment' }, current.opener())
  }, [ready, ownGroup, groupId, commitmentId, openPlanSheet])
  return null
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="type-title">
        {title}
      </h2>
      {children}
    </section>
  )
}

/**
 * A My plan row: the activity icon, the title, the state meta line and Edit when allowed. Story 5.4:
 * a snowflake button "Request freeze for Study" while the server lists something of it as freezable,
 * and a pending request's line ("Freeze vote · 21 h left").
 */
function PlanRow({
  item,
  pending,
  now,
  onRequestFreeze,
}: {
  item: MyPlanItem
  pending: FreezeRequest | null
  now: Date
  onRequestFreeze?: (button: HTMLButtonElement) => void
}) {
  const { openPlanSheet } = usePlanSheet()
  const editRef = useRef<HTMLButtonElement>(null)
  const freezeRef = useRef<HTMLButtonElement>(null)
  const title = itemTitle(item)
  const icon = item.presetKey !== null ? presetIcon(item.presetKey) : CUSTOM_ACTIVITY_ICON
  return (
    <li
      className="flex min-h-row-min items-center gap-2 rounded-wob border-[2.5px] border-line bg-card py-2 pr-2 pl-[10px]"
      data-component="plan-row"
      data-commitment-id={item.commitmentId}
      data-state={item.state}
    >
      <span className="grid size-icon-row shrink-0 place-items-center">
        <Icon icon={icon} size={44} />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="break-words type-title-sm">{title}</h3>
        <p className="break-words type-meta text-muted">{myPlanMeta(item)}</p>
        {pending ? (
          <p className="break-words type-meta text-muted" data-freeze-meta="">
            {pendingMeta(pending, now)}
          </p>
        ) : null}
      </div>
      {onRequestFreeze ? (
        <IconButton
          ref={freezeRef}
          icon={Snowflake}
          label={requestFreezeLabel(title)}
          aria-haspopup="dialog"
          onClick={() => {
            if (freezeRef.current) onRequestFreeze(freezeRef.current)
          }}
        />
      ) : null}
      {item.canEdit ? (
        <IconButton
          ref={editRef}
          icon={PencilSimple}
          label={editLabel(title)}
          aria-haspopup="dialog"
          onClick={() =>
            openPlanSheet(
              { mode: 'edit', commitmentId: item.commitmentId, kind: item.kind },
              editRef.current,
            )
          }
        />
      ) : null}
    </li>
  )
}

function Rows({
  items,
  options = [],
  requests = [],
  now,
  onRequestFreeze,
}: {
  items: readonly MyPlanItem[]
  options?: readonly FreezeOption[]
  requests?: readonly FreezeRequest[]
  now: Date
  onRequestFreeze?: (item: MyPlanItem, options: FreezeOption[], button: HTMLButtonElement) => void
}) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => {
        const own = commitmentOptions(item.commitmentId, options, now)
        return (
          <PlanRow
            key={item.commitmentId}
            item={item}
            now={now}
            pending={planRowPending(item.commitmentId, requests)}
            onRequestFreeze={
              onRequestFreeze && own.length > 0
                ? (button) => onRequestFreeze(item, own, button)
                : undefined
            }
          />
        )
      })}
    </ul>
  )
}

/** The static cold-load placeholder (shown only after 300 ms). */
function MyPlanSkeleton() {
  return (
    <Skeleton>
      <SkeletonBlock>
        <SkeletonBar />
        <SkeletonBar className="w-1/3" />
      </SkeletonBlock>
      <SkeletonBlock>
        <SkeletonBar />
        <SkeletonBar className="w-1/3" />
      </SkeletonBlock>
    </Skeleton>
  )
}

/** The Sheet's pre-pick from My plan: this week for times per week, else the first session. */
function initialFreezeKey(options: readonly FreezeOption[]): string | null {
  const option = options.find((o) => o.kind === 'week' && o.which === 'this') ?? options[0]
  return option ? freezeOptionKey(option) : null
}

/** Current, then Past (only when it has rows), in the server's order. */
function MyPlanSections({ groupId, solo }: { groupId: string; solo: boolean }) {
  const query = useMyPlan(groupId)
  const items = query.data
  const freezeOptions = useFreezeOptions(groupId).data
  const freezeRequests = useMyFreezes(groupId).data
  const now = useMinuteClock()
  const [freeze, setFreeze] = useState<{
    item: MyPlanItem
    options: FreezeOption[]
    opener: HTMLButtonElement
  } | null>(null)
  const [freezeOpen, setFreezeOpen] = useState(false)
  if (!items) {
    if (query.isError) {
      return (
        <EmptyState
          icon={CloudSlash}
          line={GROUP_COPY.loadFailedLine}
          body={GROUP_COPY.loadFailedBody}
          action={{ label: GROUP_COPY.tryAgain, onClick: () => void query.refetch() }}
        />
      )
    }
    return <MyPlanSkeleton />
  }

  const current = myPlanIn(items, 'current')
  const past = myPlanIn(items, 'past')

  return (
    <>
      <Section title={MY_PLAN_COPY.current}>
        {current.length > 0 ? (
          <Rows
            items={current}
            options={freezeOptions}
            requests={freezeRequests}
            now={now}
            onRequestFreeze={(item, options, opener) => {
              setFreeze({ item, options, opener })
              setFreezeOpen(true)
            }}
          />
        ) : (
          <EmptyState icon={ListChecks} line={MY_PLAN_COPY.emptyLine} />
        )}
      </Section>
      {past.length > 0 ? (
        <Section title={MY_PLAN_COPY.past}>
          <Rows items={past} now={now} />
        </Section>
      ) : null}
      {freeze ? (
        <FreezeSheet
          open={freezeOpen}
          onOpenChange={setFreezeOpen}
          groupId={groupId}
          title={itemTitle(freeze.item)}
          options={freeze.options}
          initialKey={initialFreezeKey(freeze.options)}
          solo={solo}
          // After a request the snowflake is gone with its option: focus the My plan h1 instead.
          returnFocusTo={() =>
            freeze.opener.isConnected
              ? freeze.opener
              : document.querySelector<HTMLElement>('main h1')
          }
        />
      ) : null}
    </>
  )
}
