import { PencilSimple, Snowflake } from '@phosphor-icons/react'
import { FREEZE_COPY } from '@/domain/freeze'
import { TODAY_COPY } from '@/domain/today'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { Sheet } from '@/ui/sheet'

/**
 * The small Sheet a Today row's Overflow opens, titled with the row's name. It holds Edit, for task
 * and commitment rows alike (Story 2.6). Edit hands over to the Plan sheet, so focus then returns
 * from the Plan sheet, not from here (`returnFocusTo`). Story 5.4: `onRequestFreeze` adds "Request
 * freeze" above Edit while the server lists the row's session (or week) as freezable; it hands over
 * to the Freeze sheet the same way.
 */
export function RowActionsSheet({
  open,
  onOpenChange,
  title,
  onEdit,
  onRequestFreeze,
  returnFocusTo,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  onEdit: () => void
  onRequestFreeze?: () => void
  returnFocusTo: () => HTMLElement | null
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} returnFocusTo={returnFocusTo}>
      <div className="flex flex-col gap-3 pb-2">
        {onRequestFreeze ? (
          <Button variant="secondary" fullWidth aria-haspopup="dialog" onClick={onRequestFreeze}>
            <Icon icon={Snowflake} size={24} />
            {FREEZE_COPY.requestFreeze}
          </Button>
        ) : null}
        <Button variant="secondary" fullWidth aria-haspopup="dialog" onClick={onEdit}>
          <Icon icon={PencilSimple} size={24} />
          {TODAY_COPY.edit}
        </Button>
      </div>
    </Sheet>
  )
}
