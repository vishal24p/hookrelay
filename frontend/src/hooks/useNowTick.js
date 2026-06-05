import { useEffect, useState } from 'react'

export function useNowTick(intervalMs = 30000) {
  const [tick, setTick] = useState(() => Date.now())

  useEffect(() => {
    if (!intervalMs || intervalMs < 1 || typeof window === 'undefined') return undefined

    const interval = window.setInterval(() => {
      setTick(Date.now())
    }, intervalMs)

    return () => window.clearInterval(interval)
  }, [intervalMs])

  return tick
}
