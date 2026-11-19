import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const root = process.env.PERMITFLOW_API_URL ?? 'http://localhost:8080'

async function request(role, path, { method = 'GET', json, body, headers, expected = 200 } = {}) {
  const response = await fetch(root + '/api/applications' + path, {
    method,
    headers: {
      Authorization: 'Basic ' + Buffer.from('demo-' + role + ':permitflow-demo').toString('base64'),
      'X-PermitFlow-Demo': '1',
      ...(json && { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: json ? JSON.stringify(json) : body,
  })
  const raw = await response.text()
  assert.equal(response.status, expected, method + ' ' + path + ' ' + raw)
  return raw && response.headers.get('content-type')?.includes('json') ? JSON.parse(raw) : raw
}

const key = randomUUID()
await request('reviewer', '/counts', { expected: 403 })
await request('reviewer', '/activity', { expected: 403 })
await request('applicant', '/activity', { expected: 403 })
const before = await request('admin', '/counts')
const submission = {
  method: 'POST', headers: { 'Idempotency-Key': key }, json: {
    purpose: 'DEMO_VISIT', arrivalAt: '2035-06-01T10:30:00+03:00', departureAt: '2035-06-09T13:34:00+03:00',
  },
}
const saved = await request('applicant', '', submission)
assert.equal(saved.status, 'SUBMITTED')
assert.equal((await request('applicant', '', submission)).id, saved.id)
await request('applicant', '', { ...submission, json: { ...submission.json, departureAt: '2035-06-09T13:35:00+03:00' }, expected: 409 })
assert.equal((await request('admin', '/counts')).SUBMITTED, before.SUBMITTED + 1)

const path = '/' + saved.id
assert.ok((await request('reviewer', '')).some(item => item.id === saved.id && item.status === 'SUBMITTED'))
assert.equal((await request('reviewer', '?status=SUBMITTED&id=' + saved.id))[0].id, saved.id)
assert.ok((await request('admin', '?query=' + saved.id.slice(0, 8))).some(item => item.id === saved.id))
await request('applicant', path + '/review', { method: 'POST', expected: 403 })
await request('admin', path + '/permit', { method: 'POST', expected: 409 })
const review = await request('reviewer', path + '/review', { method: 'POST' })
assert.equal(review.status, 'IN_REVIEW')
assert.equal((await request('reviewer', path)).application.eligible, true)
await request('reviewer', path + '/decision', { method: 'POST', json: { approved: true } })
await request('reviewer', path + '/permit', { method: 'POST', expected: 403 })
const permit = await request('admin', path + '/permit', { method: 'POST' })
assert.equal((await request('admin', path + '/permit', { method: 'POST' })).id, permit.id)

const detail = await request('applicant', path)
assert.equal(detail.permit.id, permit.id)
assert.deepEqual(detail.history.map(item => item.status), ['SUBMITTED', 'IN_REVIEW', 'APPROVED', 'ISSUED'])
assert.equal(Date.parse(permit.expiresAt) - Date.parse(detail.history.at(-1).createdAt),
  (8 * 1440 + 3 * 60 + 4) * 60_000)

const ineligible = await request('applicant', '', {
  method: 'POST', headers: { 'Idempotency-Key': randomUUID() }, json: { purpose: 'DEMO_EVENT', days: 21 },
})
const ineligiblePath = '/' + ineligible.id
await request('reviewer', ineligiblePath + '/review', { method: 'POST' })
await request('reviewer', ineligiblePath + '/decision', { method: 'POST', json: { approved: true }, expected: 409 })
assert.equal((await request('reviewer', ineligiblePath + '/decision', {
  method: 'POST', json: { approved: false },
})).status, 'REJECTED')

const timedSubmission = {
  method: 'POST',
  headers: { 'Idempotency-Key': randomUUID() },
  json: {
    purpose: 'DEMO_OTHER',
    purposeDetails: 'Fictional demo meetup',
    arrivalAt: '2035-06-01T10:30:00+03:00',
    departureAt: '2035-06-02T11:00:00+03:00',
  },
}
const timed = await request('applicant', '', timedSubmission)
assert.equal(timed.days, 2)
assert.equal(timed.purposeDetails, timedSubmission.json.purposeDetails)
assert.equal(new Date(timed.arrivalAt).toISOString(), '2035-06-01T07:30:00.000Z')
assert.equal(new Date(timed.departureAt).toISOString(), '2035-06-02T08:00:00.000Z')
assert.equal((await request('applicant', '', timedSubmission)).id, timed.id)
await request('applicant', '', {
  ...timedSubmission, json: { ...timedSubmission.json, purposeDetails: '' }, expected: 400,
})
await request('applicant', '', {
  ...timedSubmission, json: { ...timedSubmission.json, departureAt: timedSubmission.json.arrivalAt }, expected: 400,
})

const contents = await readFile(new URL('./demo-document.txt', import.meta.url), 'utf8')
const upload = new FormData()
upload.append('file', new Blob([contents], { type: 'text/plain' }), 'demo-document.txt')
await request('reviewer', path + '/documents', { method: 'POST', body: upload, expected: 403 })
const document = await request('applicant', path + '/documents', { method: 'POST', body: upload })
assert.equal((await request('applicant', path + '/documents', { method: 'POST', body: upload })).id, document.id)
assert.equal((await request('reviewer', path + '/documents'))[0].id, document.id)
assert.equal(await request('reviewer', path + '/documents/' + document.id), contents)

let activity = []
for (let attempt = 0; attempt < 20; attempt++) {
  activity = await request('admin', '/activity')
  if (activity.some(entry => entry.applicationId === saved.id && entry.kind === 'KAFKA_PUBLISHED'
    && entry.status === 'ISSUED')) break
  await new Promise(resolve => setTimeout(resolve, 1000))
}
assert.ok(activity.length <= 50)
assert.ok(activity.some(entry => entry.applicationId === saved.id && entry.kind === 'STATUS_SAVED'
  && entry.status === 'SUBMITTED'))
assert.ok(activity.some(entry => entry.applicationId === saved.id && entry.kind === 'KAFKA_PUBLISHED'
  && entry.status === 'ISSUED'))

console.log('PermitFlow smoke test passed for application ' + saved.id)
