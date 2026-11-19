/** The share of the ring to draw: 0 to 1, never more (an over-plan week stays a full ring). */
export function ringFraction(value: number, target: number): number {
  if (target <= 0) return 0
  return Math.min(1, Math.max(0, value / target))
}
