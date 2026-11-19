import { PencilSimple } from '@phosphor-icons/react'
import { TODAY_COPY } from '@/domain/today'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { Sheet } from '@/ui/sheet'

/**
 * The small Sheet a Today row's Overflow opens, titled with the row's name. For now it holds Edit
 * only (task rows; Story 2.6 adds commitment Edit). Edit hands over to the Plan sheet, so focus
 * then returns from the Plan sheet, not from here (`returnFocusTo`).
 */
export function RowActionsSheet({
  open,
  onOpenChange,
  title,
  onEdit,
  returnFocusTo,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  onEdit: () => void
  returnFocusTo: () => HTMLElement | null
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} returnFocusTo={returnFocusTo}>
      <div className="flex flex-col gap-3 pb-2">
        <Button variant="secondary" fullWidth aria-haspopup="dialog" onClick={onEdit}>
          <Icon icon={PencilSimple} size={24} />
          {TODAY_COPY.edit}
        </Button>
      </div>
    </Sheet>
  )
}
