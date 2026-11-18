import { useEffect, useRef } from 'react'
import { purposes, type Purpose } from '../model/api'
import { messages, type Locale } from '../i18n'
import type { useApplications } from '../viewmodel/useApplications'

export function formatDuration(minutes: number, locale: Locale) {
  const units = [
    ['day', Math.floor(minutes / 1440)],
    ['hour', Math.floor(minutes % 1440 / 60)],
    ['minute', minutes % 60],
  ] as const
  return new Intl.ListFormat(locale, { type: 'unit' }).format(units
    .filter(([unit, value]) => value > 0 || (minutes === 0 && unit === 'minute'))
    .map(([unit, value]) => new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'short' }).format(value)))
}

export function SubmissionForm({ vm, locale }: { vm: ReturnType<typeof useApplications>; locale: Locale }) {
  const t = messages[locale]
  const formRef = useRef<HTMLFormElement>(null)
  const purposeRef = useRef<HTMLSelectElement>(null)
  useEffect(() => {
    if (vm.submittedId) purposeRef.current?.focus()
  }, [vm.submittedId])
  useEffect(() => {
    if (vm.serverError) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [vm.serverError])
  const error = (id: string, message?: string) => message &&
    <span className="field-error" id={id}>{message}</span>

  return <section>
    <h2>{t.submitTitle}</h2>
    <form ref={formRef} noValidate aria-busy={vm.busy} onChange={vm.clearSubmissionError} onSubmit={event => {
      event.preventDefault()
      const form = event.currentTarget
      if (!vm.submit()) requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
    }}>
      <fieldset className="submission-fields" disabled={vm.busy} aria-label={t.submitTitle}>
        <label>{t.purpose}
          <select ref={purposeRef} required value={vm.purpose} aria-invalid={!!vm.errors.purpose}
            aria-describedby={vm.errors.purpose ? 'purpose-error' : undefined}
            onChange={event => vm.setPurpose(event.target.value as Purpose | '')}>
            <option value="" disabled>{t.choosePurpose}</option>
            {purposes.map(purpose => <option key={purpose} value={purpose}>{t[purpose]}</option>)}
          </select>
          {error('purpose-error', vm.errors.purpose && t[vm.errors.purpose])}
        </label>
        {vm.purpose === 'DEMO_OTHER' && <label>{t.otherDetails}
          <input required maxLength={200} placeholder={t.syntheticExample} value={vm.purposeDetails}
            aria-invalid={!!vm.errors.purposeDetails}
            aria-describedby={vm.errors.purposeDetails ? 'purpose-details-error' : undefined}
            onChange={event => vm.setPurposeDetails(event.target.value)} />
          {error('purpose-details-error', vm.errors.purposeDetails && t[vm.errors.purposeDetails])}
        </label>}
        {([
          { id: 'arrival', title: t.arrival, date: vm.arrival, time: vm.arrivalTime, setDate: vm.setArrival,
            setTime: vm.setArrivalTime, dateError: vm.errors.arrival, timeError: vm.errors.arrivalTime },
          { id: 'departure', title: t.departure, date: vm.departure, time: vm.departureTime, setDate: vm.setDeparture,
            setTime: vm.setDepartureTime, dateError: vm.errors.departure, timeError: vm.errors.departureTime || vm.errors.visit },
        ]).map(field => <fieldset className="visit-fields" key={field.id}>
          <legend>{field.title}</legend>
          <label>{t.dateLabel}
            <input type="date" required value={field.date}
              aria-invalid={!!field.dateError} aria-describedby={field.dateError ? field.id + '-date-error' : undefined}
              onChange={event => field.setDate(event.target.value)} />
            {error(field.id + '-date-error', field.dateError && t[field.dateError])}
          </label>
          <label>{t.timeLabel}
            <input dir="ltr" type="text" inputMode="numeric" placeholder="08:30" maxLength={5} required
              value={field.time} aria-invalid={!!field.timeError}
              aria-describedby={field.timeError ? field.id + '-time-error clock-format' : 'clock-format'}
              onChange={event => field.setTime(event.target.value)} />
            {error(field.id + '-time-error', field.timeError && t[field.timeError])}
          </label>
        </fieldset>)}
        <p className="form-note" id="clock-format">{t.clockFormat} {t.localTime}</p>
        <p className="duration-summary" aria-live="polite">
          {t.durationLabel}<strong>{vm.minutes && !vm.durationError ? formatDuration(vm.minutes, locale) : '–'}</strong>
        </p>
        <div><button>{t.submit}</button></div>
      </fieldset>
      {vm.serverError && !vm.errors.visit && !vm.errors.purposeDetails && <p role="alert">{t.actionError}</p>}
      <div role="status">{vm.submittedId && <p className="success-note">{t.submittedNotice}</p>}</div>
    </form>
  </section>
}
