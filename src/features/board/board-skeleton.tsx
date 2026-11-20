import { Skeleton, SkeletonBar, SkeletonBlock } from '@/ui/skeleton'

function BlockOutline({ height }: { height: string }) {
  return (
    <div
      className={`flex-1 rounded-t-[14px] border-[2.5px] border-b-0 border-dashed border-muted bg-card ${height}`}
    />
  )
}

/**
 * The Board's cold-load skeleton (after 300 ms): 3 podium block outlines and 3 leaderboard-row
 * blocks. The goal panel block joins with Story 4.7.
 */
export function BoardSkeleton() {
  return (
    <Skeleton>
      <div className="flex flex-col gap-stack" data-component="board-skeleton">
        <div className="flex items-end gap-[6px]">
          <BlockOutline height="h-[118px]" />
          <BlockOutline height="h-[150px]" />
          <BlockOutline height="h-[96px]" />
        </div>
        {[0, 1, 2].map((index) => (
          <SkeletonBlock key={index}>
            <SkeletonBar />
          </SkeletonBlock>
        ))}
      </div>
    </Skeleton>
  )
}
