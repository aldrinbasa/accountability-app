import { Skeleton, SkeletonBar, SkeletonBlock, SkeletonPhoto } from '@/ui/skeleton'

function PolaroidPlaceholder() {
  return (
    <div className="mx-auto w-[calc(100%-16px)] border-2 border-dashed border-muted bg-card px-[10px] pt-[10px] pb-3">
      <SkeletonPhoto />
      <SkeletonBar className="mt-3" />
    </div>
  )
}

/** The Feed's cold-load skeleton (after 300 ms): 2 polaroid placeholders and 1 sticky block. */
export function FeedSkeleton() {
  return (
    <Skeleton>
      <div className="flex flex-col gap-feed-gap" data-component="feed-skeleton">
        <PolaroidPlaceholder />
        <SkeletonBlock className="mx-[10px]">
          <SkeletonBar />
        </SkeletonBlock>
        <PolaroidPlaceholder />
      </div>
    </Skeleton>
  )
}

/** The next page is loading: one polaroid placeholder at the end of the wall. */
export function NextPagePlaceholder() {
  return (
    <div aria-hidden="true" className="mt-feed-gap" data-component="feed-next-page">
      <PolaroidPlaceholder />
    </div>
  )
}
