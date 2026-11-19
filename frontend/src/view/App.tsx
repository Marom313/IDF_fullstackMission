import { useEffect, useRef, useState } from 'react'
import { locales, messages, type Locale } from '../i18n'
import { roles, statuses, validQuery, visitMinutes, type Application, type Role, type Status } from '../model/api'
import { useApplications } from '../viewmodel/useApplications'
import { formatDuration, SubmissionForm } from './SubmissionForm'
import { ActivityDrawer } from './ActivityDrawer'

export function App() {
  const [locale, setLocale] = useState<Locale>('he')
  const [copiedId, setCopiedId] = useState('')
  const t = messages[locale]
  const vm = useApplications()
  const detailsHeading = useRef<HTMLHeadingElement>(null)
  const detailId = vm.detail?.application.id
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })
  const number = new Intl.NumberFormat(locale)

  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = locale === 'he' || locale === 'ar' ? 'rtl' : 'ltr'
  }, [locale])

  useEffect(() => {
    if (vm.role === 'reviewer' && detailId && detailId === vm.selected) {
      detailsHeading.current?.focus()
    }
  }, [detailId, vm.role, vm.selected])

  function renderItems(items: Application[]) {
    return <ul className="applications">
      {items.map(item => <li key={item.id}>
        <button className="application" aria-pressed={vm.selected === item.id} onClick={() => vm.setSelected(item.id)}>
          <span>{t[item.purpose]}</span>
          <span className="status" data-status={item.status}>{t[item.status]}</span>
          <bdi>{item.id}</bdi>
        </button>
        <button className="secondary" onClick={async () => {
          try {
            await navigator.clipboard.writeText(item.id)
            setCopiedId(item.id)
          } catch {
            vm.setSearchInput(item.id)
          }
        }}>{copiedId === item.id ? t.copied : t.copyId}</button>
      </li>)}
    </ul>
  }

  return <main>
    <header>
      <div><h1>PermitFlow</h1><p>{t.subtitle}</p></div>
      <div className="controls header-controls">
        <label>{t.language}
          <select value={locale} onChange={event => setLocale(event.target.value as Locale)}>
            {locales.map(value => <option key={value} value={value}>{messages[value].name}</option>)}
          </select>
        </label>
        <label>{t.role}
          <select disabled={vm.busy} value={vm.role} onChange={event => vm.changeRole(event.target.value as Role)}>
            {roles.map(role => <option key={role} value={role}>{t[role]}</option>)}
          </select>
        </label>
      </div>
    </header>
    {vm.role === 'applicant' && <SubmissionForm locale={locale} vm={vm} />}
    {vm.actionError && <p role="alert">{t.actionError}</p>}
    <section>
      <div className="controls">
        <h2>{t.applications}</h2>
        {vm.role === 'admin' && <ActivityDrawer locale={locale} />}
        {vm.role !== 'admin' && <select aria-label={t.all} value={vm.status} onChange={event => vm.changeStatus(event.target.value as Status | '')}>
          <option value="">{t.all}</option>
          {statuses.map(status => <option key={status} value={status}>{t[status]}</option>)}
        </select>}
      </div>
      {vm.role === 'reviewer' && <p className="form-note">{t.reviewerInstructions}</p>}
      {vm.role === 'admin' && <div className="controls status-filters" role="group" aria-label={t.all}>
        {(['', ...statuses] as const).map(status => <button key={status} className="secondary status-filter"
          aria-pressed={vm.status === status} onClick={() => vm.changeStatus(status)}>
          {status ? t[status] : t.all}
          {vm.counts && <span className="status-count">{number.format(status ? (vm.counts[status] ?? 0) :
            Object.values(vm.counts).reduce((sum, count) => sum + count, 0))}</span>}
        </button>)}
      </div>}
      {vm.role === 'admin' && vm.countsError && <p role="status">{t.countsError}</p>}
      <form className="controls search" onSubmit={event => { event.preventDefault(); vm.searchById() }}>
        <label>{t.applicationId}
          <input dir="ltr" placeholder="a1b2c3d4" aria-describedby="search-hint" value={vm.searchInput}
            onChange={event => vm.setSearchInput(event.target.value)} />
        </label>
        <button disabled={!validQuery(vm.searchInput.trim())}>{t.search}</button>
        {(vm.search || vm.searchInput) && <button type="button" className="secondary" onClick={vm.clearSearch}>{t.clearSearch}</button>}
        <p className="form-note" id="search-hint">{t.searchHint}</p>
      </form>
      {vm.listError ? <p role="alert">{t.loadError}</p> : vm.listLoading ? <p role="status">{t.loading}</p> :
        vm.items.length === 0 ? <p>{vm.search ? t.noMatches : t.empty}</p> :
        vm.role === 'admin' && !vm.status ? statuses.map(status => {
          const items = vm.items.filter(item => item.status === status)
          return items.length > 0 && <div className="application-group" key={status}>
            <h3>{t[status]}</h3>{renderItems(items)}
          </div>
        }) : renderItems(vm.items)}
      <div className="controls">
        <button disabled={vm.page === 0 || vm.listLoading} onClick={() => vm.setPage(vm.page - 1)}>{t.previous}</button>
        <button disabled={vm.items.length < 50 || vm.listLoading || vm.listError} onClick={() => vm.setPage(vm.page + 1)}>{t.next}</button>
      </div>
    </section>
    {vm.detailError && <p role="alert">{t.loadError}</p>}
    {vm.selected && !vm.detail && !vm.detailError && <p role="status">{t.loading}</p>}
    {vm.detail && vm.detail.application.id === vm.selected && <section>
      <h2 ref={detailsHeading} tabIndex={-1}>{t.details}</h2>
      <dl>
        <dt>{t.applicationId}</dt><dd><bdi>{vm.detail.application.id}</bdi></dd>
        <dt>{t.purpose}</dt><dd>{t[vm.detail.application.purpose]}</dd>
        {vm.detail.application.purposeDetails && <>
          <dt>{t.otherDetails}</dt><dd>{vm.detail.application.purposeDetails}</dd>
        </>}
        {vm.detail.application.arrivalAt && vm.detail.application.departureAt && <>
          <dt>{t.arrival}</dt><dd>{date.format(new Date(vm.detail.application.arrivalAt))}</dd>
          <dt>{t.departure}</dt><dd>{date.format(new Date(vm.detail.application.departureAt))}</dd>
        </>}
        <dt>{t.durationLabel}</dt><dd>{formatDuration(
          vm.detail.application.arrivalAt && vm.detail.application.departureAt
            ? visitMinutes(vm.detail.application.arrivalAt, vm.detail.application.departureAt)
            : vm.detail.application.days * 1440, locale)}</dd>
        <dt>{t.eligibility}</dt><dd>{vm.detail.application.eligible ? t.eligible : t.ineligible}</dd>
        {vm.detail.permit && <>
          <dt>{t.permit}</dt><dd><bdi>{vm.detail.permit.id}</bdi></dd>
          <dt>{t.expires}</dt><dd>{date.format(new Date(vm.detail.permit.expiresAt))}</dd>
        </>}
      </dl>
      <div className="controls">
        {vm.role !== 'applicant' && vm.detail.application.status === 'SUBMITTED' &&
          <button disabled={vm.busy} onClick={() => void vm.act('review')}>{t.review}</button>}
        {vm.role !== 'applicant' && vm.detail.application.status === 'IN_REVIEW' && <>
          <button disabled={vm.busy || !vm.detail.application.eligible}
            aria-describedby={vm.detail.application.eligible ? undefined : 'approval-unavailable'}
            onClick={() => void vm.act('decision', true)}>{t.approve}</button>
          <button disabled={vm.busy} onClick={() => void vm.act('decision', false)}>{t.reject}</button>
          {!vm.detail.application.eligible && <p id="approval-unavailable" className="form-note">{t.approvalUnavailable}</p>}
        </>}
        {vm.role === 'admin' && vm.detail.application.status === 'APPROVED' &&
          <button disabled={vm.busy} onClick={() => void vm.act('permit')}>{t.issue}</button>}
      </div>
      <h3>{t.documents}</h3>
      {vm.role === 'applicant' && <form className="controls" onSubmit={event => {
        event.preventDefault()
        const form = event.currentTarget
        const file = new FormData(form).get('file')
        if (file instanceof File && file.size > 0) void vm.upload(file)
      }}>
        <label>{t.demoDocument}<input name="file" type="file" accept=".txt,text/plain" required /></label>
        <button disabled={vm.busy}>{t.upload}</button>
      </form>}
      {vm.documents.length > 0 && <ul>
        {vm.documents.map(file => <li key={file.id}>
          <button onClick={async () => {
            const blob = await vm.download(file)
            if (!blob) return
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = file.filename
            link.click()
            setTimeout(() => URL.revokeObjectURL(url), 1000)
          }}><bdi>{file.filename}</bdi></button>
        </li>)}
      </ul>}
      <h3>{t.history}</h3>
      <ol className="timeline">
        {vm.detail.history.map((entry, index) => <li key={index}>
          <span className="status" data-status={entry.status}>{t[entry.status]}</span>
          <div className="timeline-meta">
            <bdi>{entry.actor}</bdi>
            <time dateTime={entry.createdAt}>{date.format(new Date(entry.createdAt))}</time>
          </div>
        </li>)}
      </ol>
    </section>}
  </main>
}
