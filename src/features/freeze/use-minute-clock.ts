import { useEffect, useState } from 'react'

/**
 * The clock freeze controls compare the server's timestamps with: taken on mount, then once a
 * minute ("21 h left", whether a window is still open). Never used for window math (AD-11).
 */
export function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  return now
}
