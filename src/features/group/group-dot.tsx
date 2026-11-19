import { cn } from '@/ui/lib/utils'

/** The small `success` group dot: outlined only for a waiting group, filled once it is active. */
export function GroupDot({ waiting, className }: { waiting: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-waiting={waiting || undefined}
      className={cn(
        'inline-block size-[10px] shrink-0 rounded-full',
        waiting ? 'border-[2.5px] border-success' : 'bg-success',
        className,
      )}
    />
  )
}
