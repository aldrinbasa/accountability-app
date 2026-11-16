import { useEffect, useState } from 'react'
import { RESEND_COOLDOWN_MS } from '@/domain/auth'

function secondsLeft(sentAt: number, cooldownMs: number, now: number): number {
  const ms = Math.min(cooldownMs, sentAt + cooldownMs - now)
  return Math.max(0, Math.ceil(ms / 1000))
}

/** Whole seconds until "Resend code" works again: 30 right after a send, then down to 0. */
export function useResendCountdown(
  sentAt: number,
  cooldownMs: number = RESEND_COOLDOWN_MS,
): number {
  const [left, setLeft] = useState(() => secondsLeft(sentAt, cooldownMs, Date.now()))

  useEffect(() => {
    const tick = () => {
      const value = secondsLeft(sentAt, cooldownMs, Date.now())
      setLeft(value)
      return value
    }
    if (tick() === 0) return
    const id = window.setInterval(() => {
      if (tick() === 0) window.clearInterval(id)
    }, 250)
    return () => window.clearInterval(id)
  }, [sentAt, cooldownMs])

  return left
}
