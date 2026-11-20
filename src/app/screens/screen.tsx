import type { ReactNode } from 'react'

/** A tab screen: exactly one h1 (focus target on route change), then the screen content. */
export function Screen({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-stack pt-4">
      <h1 tabIndex={-1} className="type-headline">
        {title}
      </h1>
      {children}
    </div>
  )
}
