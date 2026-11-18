import { useEffect, useRef, useState } from 'react'
import { api, validQuery, visitDuration, type Application, type Detail, type DocumentMetadata, type Purpose, type Role, type Status } from '../model/api'

export function useApplications() {
  const [role, setRole] = useState<Role>('applicant')
  const [status, setStatus] = useState<Status | ''>('')
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [items, setItems] = useState<Application[]>([])
  const [selected, setSelected] = useState('')
  const [detail, setDetail] = useState<Detail>()
  const [documents, setDocuments] = useState<DocumentMetadata[]>([])
  const [purpose, setPurpose] = useState<Purpose>('DEMO_VISIT')
  const [arrival, setArrival] = useState('')
  const [departure, setDeparture] = useState('')
  const [purposeDetails, setPurposeDetails] = useState('')
  const days = visitDuration(arrival, departure)
  const validVisit = days >= 1 && days <= 90
  const canSubmit = validVisit && (purpose !== 'DEMO_OTHER' || !!purposeDetails.trim())
  const [revision, refresh] = useState(0)
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState(false)
  const [detailError, setDetailError] = useState(false)
  const [actionError, setActionError] = useState(false)
  const [busy, setBusy] = useState(false)
  const pending = useRef<{ fingerprint: string; key: string } | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()
    setListLoading(true)
    setListError(false)
    api.list(role, page, status, search, controller.signal).then(items => {
      if (!controller.signal.aborted) {
        setItems(items)
        setListLoading(false)
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setListError(true)
        setListLoading(false)
      }
    })
    return () => controller.abort()
  }, [role, page, status, search, revision])

  useEffect(() => {
    setDetail(undefined)
    setDocuments([])
    setDetailError(false)
    if (!selected) return
    const controller = new AbortController()
    Promise.all([api.detail(role, selected, controller.signal), api.documents(role, selected, controller.signal)])
      .then(([data, files]) => {
      if (!controller.signal.aborted) {
        setDetail(data)
        setDocuments(files)
      }
    }).catch(() => {
      if (!controller.signal.aborted) setDetailError(true)
    })
    return () => controller.abort()
  }, [role, selected, revision])

  async function mutate(action: () => Promise<unknown>) {
    setBusy(true)
    setActionError(false)
    try {
      await action()
      refresh(value => value + 1)
    } catch {
      setActionError(true)
    } finally {
      setBusy(false)
    }
  }

  function submit() {
    if (!canSubmit) return
    const submission = {
      purpose,
      arrivalAt: new Date(arrival).toISOString(),
      departureAt: new Date(departure).toISOString(),
      ...(purpose === 'DEMO_OTHER' && { purposeDetails: purposeDetails.trim() }),
    }
    const fingerprint = JSON.stringify(submission)
    pending.current ??= { fingerprint, key: crypto.randomUUID() }
    if (pending.current.fingerprint !== fingerprint) {
      pending.current = { fingerprint, key: crypto.randomUUID() }
    }
    const { key } = pending.current
    void mutate(async () => {
      const application = await api.submit(role, submission, key)
      pending.current = undefined
      setStatus('')
      setPage(0)
      setSearch('')
      setSearchInput('')
      setSelected(application.id)
    })
  }

  return {
    role, status, page, items, selected, detail, documents, purpose, days, listLoading, listError, detailError, actionError, busy,
    arrival, departure, purposeDetails, validVisit, canSubmit, setArrival, setDeparture, setPurposeDetails,
    search, searchInput, setSearchInput, setPurpose, setSelected, setPage, submit,
    searchById() {
      const id = searchInput.trim()
      if (id && !validQuery(id)) return
      setSearch(id)
      setSelected('')
      setStatus('')
      setPage(0)
    },
    clearSearch() {
      setSearch('')
      setSearchInput('')
      setPage(0)
    },
    changeRole(nextRole: Role) {
      setSelected('')
      setDetail(undefined)
      setItems([])
      setPage(0)
      setStatus('')
      setActionError(false)
      setRole(nextRole)
    },
    changeStatus(nextStatus: Status | '') {
      setPage(0)
      setStatus(nextStatus)
    },
    act: (action: 'review' | 'decision' | 'permit', approved?: boolean) =>
      mutate(() => api.act(role, selected, action, approved)),
    upload: (file: File) => mutate(() => api.upload(role, selected, file)),
    async download(document: DocumentMetadata) {
      setActionError(false)
      try {
        return await api.download(role, selected, document)
      } catch {
        setActionError(true)
      }
    },
  }
}
