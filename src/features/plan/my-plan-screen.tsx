import { useEffect, useId, useRef, type ReactNode } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { ArrowLeft, CloudSlash, ListChecks, PencilSimple } from '@phosphor-icons/react'
import { CUSTOM_ACTIVITY_ICON, presetIcon } from '@/domain/activities'
import { GROUP_COPY } from '@/domain/groups'
import { editLabel, MY_PLAN_COPY, myPlanIn, myPlanMeta, type MyPlanItem } from '@/domain/my-plan'
import { itemTitle } from '@/domain/today'
import { useMyPlan } from '@/data/plan'
import { EmptyState } from '@/ui/empty-state'
import { Icon } from '@/ui/icon'
import { IconButton } from '@/ui/icon-button'
import { runAfterSheetClose } from '@/ui/sheet-history'
import { Skeleton, SkeletonBar, SkeletonBlock } from '@/ui/skeleton'
import { useFocusedGroup } from '@/features/group/use-focused-group'
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
 * "That's already wrapped up." System back closes an open sheet first, then pops My plan.
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
            <MyPlanSections groupId={group.id} />
          </div>
          {commitmentId ? (
            <DeepLinkEdit commitmentId={commitmentId} opener={() => headingRef.current} />
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

/** Opens the deep link's commitment in the Plan sheet once, as the screen mounts. */
function DeepLinkEdit({
  commitmentId,
  opener,
}: {
  commitmentId: string
  opener: () => HTMLElement | null
}) {
  const { openPlanSheet } = usePlanSheet()
  const opened = useRef<string | null>(null)
  useEffect(() => {
    if (opened.current === commitmentId) return
    opened.current = commitmentId
    openPlanSheet({ mode: 'edit', commitmentId, kind: 'commitment' }, opener())
  }, [commitmentId, openPlanSheet, opener])
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

/** A My plan row: the activity icon, the title, the state meta line and Edit when allowed. */
function PlanRow({ item }: { item: MyPlanItem }) {
  const { openPlanSheet } = usePlanSheet()
  const editRef = useRef<HTMLButtonElement>(null)
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
      </div>
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

function Rows({ items }: { items: readonly MyPlanItem[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <PlanRow key={item.commitmentId} item={item} />
      ))}
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

/** Current, then Past (only when it has rows), in the server's order. */
function MyPlanSections({ groupId }: { groupId: string }) {
  const query = useMyPlan(groupId)
  const items = query.data
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
          <Rows items={current} />
        ) : (
          <EmptyState icon={ListChecks} line={MY_PLAN_COPY.emptyLine} />
        )}
      </Section>
      {past.length > 0 ? (
        <Section title={MY_PLAN_COPY.past}>
          <Rows items={past} />
        </Section>
      ) : null}
    </>
  )
}
