/** Block look per place (DESIGN.md `podium`): 1st coral center, 2nd lavender left, 3rd yellow right. */
export const PODIUM_PLACE = {
  1: { fill: 'bg-primary', height: 'min-h-[150px]', order: 'order-2' },
  2: { fill: 'bg-vote', height: 'min-h-[118px]', order: 'order-1' },
  3: { fill: 'bg-sticky', height: 'min-h-[96px]', order: 'order-3' },
} as const
