import { useEffect, useState } from 'react'
import { api, type ActivityEntry } from '../model/api'

export function useActivity(open: boolean) {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true)
    setError(false)
    api.activity(controller.signal).then(result => {
      if (!controller.signal.aborted) setEntries(result)
    }).catch(() => {
      if (!controller.signal.aborted) setError(true)
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [open, revision])

  return { entries, loading, error, refresh: () => setRevision(value => value + 1) }
}
