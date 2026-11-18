import { useEffect, useState } from 'react'
import { locales, messages, type Locale } from '../i18n'
import { purposes, roles, statuses, validId, type Purpose, type Role, type Status } from '../model/api'
import { useApplications } from '../viewmodel/useApplications'

export function App() {
  const [locale, setLocale] = useState<Locale>('he')
  const t = messages[locale]
  const vm = useApplications()
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })

  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = locale === 'he' || locale === 'ar' ? 'rtl' : 'ltr'
  }, [locale])

  return <main>
    <header>
      <div><h1>PermitFlow</h1><p>{t.subtitle}</p></div>
      <div className="controls">
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
    {vm.role === 'applicant' && <section>
      <h2>{t.submitTitle}</h2>
      <form onSubmit={event => { event.preventDefault(); vm.submit() }} className="controls">
        <label>{t.purpose}
          <select value={vm.purpose} onChange={event => vm.setPurpose(event.target.value as Purpose)}>
            {purposes.map(purpose => <option key={purpose} value={purpose}>{t[purpose]}</option>)}
          </select>
        </label>
        <label>{t.days}
          <input type="number" required min="1" max="90" value={Number.isNaN(vm.days) ? '' : vm.days}
            onChange={event => vm.setDays(event.target.valueAsNumber)} />
        </label>
        <button disabled={vm.busy}>{t.submit}</button>
      </form>
    </section>}
    {vm.actionError && <p role="alert">{t.actionError}</p>}
    <section>
      <div className="controls">
        <h2>{t.applications}</h2>
        <select aria-label={t.all} value={vm.status} onChange={event => vm.changeStatus(event.target.value as Status | '')}>
          <option value="">{t.all}</option>
          {statuses.map(status => <option key={status} value={status}>{t[status]}</option>)}
        </select>
      </div>
      <form className="controls search" onSubmit={event => { event.preventDefault(); vm.searchById() }}>
        <label>{t.applicationId}
          <input dir="ltr" value={vm.searchInput} onChange={event => vm.setSearchInput(event.target.value)} />
        </label>
        <button disabled={!!vm.searchInput.trim() && !validId(vm.searchInput.trim())}>{t.search}</button>
      </form>
      {vm.listError ? <p role="alert">{t.loadError}</p> : vm.listLoading ? <p role="status">{t.loading}</p> :
        vm.items.length === 0 ? <p>{t.empty}</p> :
          <ul className="applications">
            {vm.items.map(item => <li key={item.id}>
              <button aria-pressed={vm.selected === item.id} onClick={() => vm.setSelected(item.id)}>
                <span>{t[item.purpose]} · {t[item.status]}</span>
                <bdi>{item.id}</bdi>
              </button>
            </li>)}
          </ul>}
      <div className="controls">
        <button disabled={vm.page === 0 || vm.listLoading} onClick={() => vm.setPage(vm.page - 1)}>{t.previous}</button>
        <button disabled={vm.items.length < 50 || vm.listLoading || vm.listError} onClick={() => vm.setPage(vm.page + 1)}>{t.next}</button>
      </div>
    </section>
    {vm.detailError && <p role="alert">{t.loadError}</p>}
    {vm.selected && !vm.detail && !vm.detailError && <p role="status">{t.loading}</p>}
    {vm.detail && vm.detail.application.id === vm.selected && <section>
      <h2>{t.details}</h2>
      <dl>
        <dt>{t.purpose}</dt><dd>{t[vm.detail.application.purpose]}</dd>
        <dt>{t.days}</dt><dd>{vm.detail.application.days}</dd>
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
          <button disabled={vm.busy || !vm.detail.application.eligible} onClick={() => void vm.act('decision', true)}>{t.approve}</button>
          <button disabled={vm.busy} onClick={() => void vm.act('decision', false)}>{t.reject}</button>
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
      <ul>
        {vm.detail.history.map((entry, index) => <li key={index}>
          {t[entry.status]} · <bdi>{entry.actor}</bdi> · {date.format(new Date(entry.createdAt))}
        </li>)}
      </ul>
    </section>}
  </main>
}
