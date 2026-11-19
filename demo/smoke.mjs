import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = process.env.PERMITFLOW_API_URL ?? 'http://localhost:8080'
const repo = fileURLToPath(new URL('../', import.meta.url))
const topic = 'permitflow.application-events'

function composeExec(service, ...args) {
  return execFileSync('docker', ['compose', 'exec', '-T', service, ...args], {
    cwd: repo, encoding: 'utf8', timeout: 30_000,
  }).trim()
}

function postgres(sql) {
  return JSON.parse(composeExec('postgres', 'psql', '-XAt', '-v', 'ON_ERROR_STOP=1',
    '-U', 'permitflow', '-d', 'permitflow', '-c', sql))
}

function kafkaEndOffset() {
  const output = composeExec('kafka', '/opt/kafka/bin/kafka-get-offsets.sh',
    '--bootstrap-server', 'localhost:9092', '--topic', topic, '--time', 'latest')
  const match = /^permitflow\.application-events:0:(\d+)$/.exec(output)
  assert.ok(match, 'Expected the local demo topic to have one partition')
  return Number(match[1])
}

async function request(role, path, { method = 'GET', json, body, headers, expected = 200 } = {}) {
  const response = await fetch(root + '/api/applications' + path, {
    method,
    headers: {
      ...(role && { Authorization: 'Basic ' + Buffer.from('demo-' + role + ':permitflow-demo').toString('base64') }),
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
const firstOffset = kafkaEndOffset()
await request(null, '/activity', { expected: 401 })
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
assert.match(saved.id, /^[0-9a-f-]{36}$/)
const stored = postgres(`SELECT json_build_object('id', id, 'status', status, 'purpose', purpose)
  FROM public.applications WHERE id = '${saved.id}';`)
assert.deepEqual(stored, { id: saved.id, status: 'SUBMITTED', purpose: submission.json.purpose })
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

const outbox = postgres(`SELECT json_agg(json_build_object('eventId', event_id,
  'applicationId', application_id, 'eventType', event_type, 'status', status,
  'published', published_at IS NOT NULL) ORDER BY sequence)
  FROM public.outbox WHERE application_id = '${saved.id}';`)
assert.deepEqual(outbox.map(event => [event.eventType, event.status, event.published]), [
  ['ApplicationSubmitted', 'SUBMITTED', true],
  ['DecisionMade', 'APPROVED', true],
  ['PermitIssued', 'ISSUED', true],
])

const messageCount = kafkaEndOffset() - firstOffset
assert.ok(messageCount >= outbox.length)
const kafkaEvents = composeExec('kafka', '/opt/kafka/bin/kafka-console-consumer.sh',
  '--bootstrap-server', 'localhost:9092', '--topic', topic, '--partition', '0',
  '--offset', String(firstOffset), '--max-messages', String(messageCount), '--timeout-ms', '10000')
  .split(/\r?\n/).map(line => JSON.parse(line)).filter(event => event.applicationId === saved.id)
assert.deepEqual([...new Set(kafkaEvents.map(event => event.eventId))], outbox.map(event => event.eventId))
for (const event of kafkaEvents) {
  const expected = outbox.find(entry => entry.eventId === event.eventId)
  assert.equal(event.eventType, expected.eventType)
  assert.equal(event.status, expected.status)
}

const auditCommand = `print(JSON.stringify(db.application_events
  .find({applicationId: ${JSON.stringify(saved.id)}}, {_id: 1, eventType: 1, status: 1}).toArray()))`
let audit = []
for (let attempt = 0; attempt < 15; attempt++) {
  audit = JSON.parse(composeExec('mongo', 'mongosh', 'permitflow', '--quiet', '--eval', auditCommand))
  if (audit.length >= outbox.length) break
  await new Promise(resolve => setTimeout(resolve, 1000))
}
assert.deepEqual(audit.map(event => [event._id, event.eventType, event.status]).sort(),
  outbox.map(event => [event.eventId, event.eventType, event.status]).sort())

console.log('PermitFlow smoke test passed for application ' + saved.id)
