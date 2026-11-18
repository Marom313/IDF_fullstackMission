import { useRef, useState } from 'react'
import { messages, type Locale } from '../i18n'
import { useActivity } from '../viewmodel/useActivity'

export function ActivityDrawer({ locale }: { locale: Locale }) {
  const t = messages[locale]
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium' })
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const activity = useActivity(open)

  return <>
    <button ref={trigger} className="secondary" type="button" onClick={() => {
      dialog.current?.showModal()
      setOpen(true)
    }}>{t.activityLogs}</button>
    <dialog ref={dialog} className="activity-drawer" aria-labelledby="activity-title" onClose={() => {
      setOpen(false)
      trigger.current?.focus()
    }}>
      <div className="activity-heading">
        <h2 id="activity-title">{t.activityLogs}</h2>
        <form method="dialog"><button className="secondary">{t.closeActivity}</button></form>
      </div>
      <p className="form-note">{t.activityDescription}</p>
      <button className="secondary" type="button" onClick={activity.refresh} disabled={activity.loading}>
        {t.refreshActivity}
      </button>
      {activity.loading ? <p role="status">{t.loading}</p> :
        activity.error ? <p role="alert">{t.loadError}</p> :
        activity.entries.length === 0 ? <p>{t.emptyActivity}</p> :
        <ol className="activity-entries">
          {activity.entries.map(entry => <li key={entry.id}>
            <div><strong>{t[entry.kind]}</strong> <span className="status" data-status={entry.status}>{t[entry.status]}</span></div>
            <time dateTime={entry.occurredAt}>{date.format(new Date(entry.occurredAt))}</time>
            <bdi>{entry.applicationId}</bdi>
          </li>)}
        </ol>}
    </dialog>
  </>
}
