import { useState } from 'react'
import { Check } from '@phosphor-icons/react'
import {
  PROFILE_COPY,
  titleButtonLabel,
  titleName,
  titleRungText,
  type Title,
} from '@/domain/badges'
import { useTitles } from '@/data/member-profile'
import { Icon } from '@/ui/icon'
import { Sheet } from '@/ui/sheet'
import { cn } from '@/ui/lib/utils'

/**
 * The Title sticky (DESIGN.md `title-sticky`): a yellow sticky with the current title in hand-lg,
 * tilted -2deg, a light object in both themes. A tap opens the title ladder Sheet: every title
 * with its threshold, the current one marked with a check and "current title" (not color alone).
 * Draws nothing until the ladder has loaded (the name comes from it).
 */
export function TitleSticky({ titleKey }: { titleKey: string | null }) {
  const { data: titles } = useTitles()
  const [open, setOpen] = useState(false)
  const name = titleName(titles, titleKey)
  if (!name) return null
  return (
    <>
      <button
        type="button"
        aria-label={titleButtonLabel(name)}
        onClick={() => setOpen(true)}
        className="on-object min-h-target-min -rotate-2 self-start rounded-sticky bg-sticky px-[14px] py-1.5 type-hand-lg text-obj-ink shadow-sticky press-overlay"
        data-component="title-sticky"
      >
        {name}
      </button>
      <Sheet open={open} onOpenChange={setOpen} title={PROFILE_COPY.titles}>
        <TitleLadder titles={titles ?? []} current={titleKey} />
      </Sheet>
    </>
  )
}

function TitleLadder({ titles, current }: { titles: readonly Title[]; current: string | null }) {
  return (
    <ol className="flex flex-col gap-1 pb-2" data-component="title-ladder">
      {titles.map((title) => {
        const isCurrent = title.key === current
        return (
          <li
            key={title.key}
            className={cn(
              'flex min-h-target-min items-center gap-2 rounded-wob px-2 type-body',
              isCurrent && 'border-[2.5px] border-line bg-card font-extrabold',
            )}
            aria-current={isCurrent ? 'true' : undefined}
          >
            <span className="flex-1">{titleRungText(title)}</span>
            {isCurrent ? (
              <span className="inline-flex items-center gap-1 type-meta">
                <Icon icon={Check} size={20} />
                {PROFILE_COPY.current}
              </span>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
