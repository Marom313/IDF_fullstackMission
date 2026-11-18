import { useEffect, useRef, useState } from 'react'
import { api, validQuery, visitDateTime, visitMinutes, type Application, type Detail, type DocumentMetadata, type Purpose, type Role, type Status } from '../model/api'

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
  const [purpose, setPurpose] = useState<Purpose | ''>('')
  const [arrival, setArrival] = useState('')
  const [departure, setDeparture] = useState('')
  const [arrivalTime, setArrivalTime] = useState('')
  const [departureTime, setDepartureTime] = useState('')
  const [purposeDetails, setPurposeDetails] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [serverError, setServerError] = useState('')
  const [submittedId, setSubmittedId] = useState('')
  const [counts, setCounts] = useState<Partial<Record<Status, number>>>()
  const [countsError, setCountsError] = useState(false)
  const arrivalAt = visitDateTime(arrival, arrivalTime)
  const departureAt = visitDateTime(departure, departureTime)
  const minutes = arrivalAt && departureAt ? visitMinutes(arrivalAt, departureAt) : undefined
  const durationError = minutes !== undefined && (minutes < 1 || minutes > 90 * 1440)
  const errors = {
    purpose: attempted && !purpose ? 'requiredField' : undefined,
    purposeDetails: attempted && purpose === 'DEMO_OTHER' && !purposeDetails.trim() ? 'requiredField' :
      serverError === 'INVALID_PURPOSE_DETAILS' ? 'requiredField' : undefined,
    arrival: attempted && !arrival ? 'requiredField' : undefined,
    departure: attempted && !departure ? 'requiredField' : undefined,
    arrivalTime: attempted && !arrivalTime.trim() ? 'requiredField' :
      arrival && arrivalTime && !arrivalAt ? 'invalidTime' : undefined,
    departureTime: attempted && !departureTime.trim() ? 'requiredField' :
      departure && departureTime && !departureAt ? 'invalidTime' : undefined,
    visit: durationError || serverError === 'INVALID_VISIT_DATES' ? 'invalidDates' : undefined,
  } as const
  const [revision, refresh] = useState(0)
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState(false)
  const [detailError, setDetailError] = useState(false)
  const [actionError, setActionError] = useState(false)
  const [busy, setBusy] = useState(false)
  const pending = useRef<{ fingerprint: string; key: string } | undefined>(undefined)

  useEffect(() => {
    if (role !== 'admin') return
    const controller = new AbortController()
    setCountsError(false)
    api.counts(role, controller.signal).then(data => {
      if (!controller.signal.aborted) setCounts(data)
    }).catch(() => {
      if (!controller.signal.aborted) setCountsError(true)
    })
    return () => controller.abort()
  }, [role, revision])

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

  async function mutate(action: () => Promise<unknown>, onError: (error: unknown) => void = () => setActionError(true)) {
    setBusy(true)
    setActionError(false)
    try {
      await action()
      refresh(value => value + 1)
    } catch (error) {
      onError(error)
    } finally {
      setBusy(false)
    }
  }

  function submit() {
    setAttempted(true)
    setServerError('')
    setSubmittedId('')
    if (!purpose || !arrivalAt || !departureAt || durationError || (purpose === 'DEMO_OTHER' && !purposeDetails.trim())) {
      return false
    }
    const submission = {
      purpose,
      arrivalAt: arrivalAt.toISOString(),
      departureAt: departureAt.toISOString(),
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
      setPurpose('')
      setPurposeDetails('')
      setArrival('')
      setDeparture('')
      setArrivalTime('')
      setDepartureTime('')
      setAttempted(false)
      setSubmittedId(application.id)
      setStatus('')
      setPage(0)
      setSearch('')
      setSearchInput('')
      setSelected(application.id)
    }, (error: unknown) => {
      setServerError(error instanceof Error ? error.message : 'unknown')
    })
    return true
  }

  return {
    role, status, page, items, selected, detail, documents, purpose, listLoading, listError, detailError, actionError, busy,
    arrival, departure, arrivalTime, departureTime, purposeDetails, minutes, durationError, errors, serverError, submittedId,
    counts, countsError, setArrival, setDeparture, setArrivalTime, setDepartureTime, setPurposeDetails,
    clearSubmissionError: () => setServerError(''),
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
      setCounts(undefined)
      setCountsError(false)
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
