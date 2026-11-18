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
const submission = { method: 'POST', headers: { 'Idempotency-Key': key }, json: { purpose: 'DEMO_VISIT', days: 7 } }
const saved = await request('applicant', '', submission)
assert.equal(saved.status, 'SUBMITTED')
assert.equal((await request('applicant', '', submission)).id, saved.id)
await request('applicant', '', { ...submission, json: { ...submission.json, days: 8 }, expected: 409 })

const path = '/' + saved.id
assert.equal((await request('reviewer', '?status=SUBMITTED&id=' + saved.id))[0].id, saved.id)
await request('applicant', path + '/review', { method: 'POST', expected: 403 })
await request('admin', path + '/permit', { method: 'POST', expected: 409 })
await request('reviewer', path + '/review', { method: 'POST' })
await request('reviewer', path + '/decision', { method: 'POST', json: { approved: true } })
await request('reviewer', path + '/permit', { method: 'POST', expected: 403 })
const permit = await request('admin', path + '/permit', { method: 'POST' })
assert.equal((await request('admin', path + '/permit', { method: 'POST' })).id, permit.id)

const detail = await request('applicant', path)
assert.equal(detail.permit.id, permit.id)
assert.deepEqual(detail.history.map(item => item.status), ['SUBMITTED', 'IN_REVIEW', 'APPROVED', 'ISSUED'])

const ineligible = await request('applicant', '', {
  method: 'POST', headers: { 'Idempotency-Key': randomUUID() }, json: { purpose: 'DEMO_EVENT', days: 21 },
})
const ineligiblePath = '/' + ineligible.id
await request('reviewer', ineligiblePath + '/review', { method: 'POST' })
await request('reviewer', ineligiblePath + '/decision', { method: 'POST', json: { approved: true }, expected: 409 })
assert.equal((await request('reviewer', ineligiblePath + '/decision', {
  method: 'POST', json: { approved: false },
})).status, 'REJECTED')

const contents = await readFile(new URL('./demo-document.txt', import.meta.url), 'utf8')
const upload = new FormData()
upload.append('file', new Blob([contents], { type: 'text/plain' }), 'demo-document.txt')
await request('reviewer', path + '/documents', { method: 'POST', body: upload, expected: 403 })
const document = await request('applicant', path + '/documents', { method: 'POST', body: upload })
assert.equal((await request('applicant', path + '/documents', { method: 'POST', body: upload })).id, document.id)
assert.equal((await request('reviewer', path + '/documents'))[0].id, document.id)
assert.equal(await request('reviewer', path + '/documents/' + document.id), contents)

console.log('PermitFlow smoke test passed for application ' + saved.id)
