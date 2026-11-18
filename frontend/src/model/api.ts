import type { components } from './openapi'

export const statuses = ['SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'ISSUED', 'EXPIRED'] as const
export const purposes = ['DEMO_VISIT', 'DEMO_EVENT', 'DEMO_OTHER'] as const
export const roles = ['applicant', 'reviewer', 'admin'] as const

type Schemas = components['schemas']
export type Status = Application['status']
export type Purpose = Submission['purpose']
export type Role = typeof roles[number]
export type Application = Schemas['Application']
export type Detail = Schemas['Detail']
export type Submission = Schemas['Submission']
export type DocumentMetadata = Schemas['Metadata']

export const validDays = (days: number) => Number.isInteger(days) && days >= 1 && days <= 90
export const validId = (id: string) => /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)

async function fetchApplication(role: Role, path: string, options?: RequestInit): Promise<Response> {
  const response = await fetch('/api/applications' + path, {
    ...options,
    headers: {
      Authorization: 'Basic ' + btoa('demo-' + role + ':permitflow-demo'),
      'X-PermitFlow-Demo': '1',
      ...options?.headers,
    },
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(String(response.status))
  }
  return response
}

async function request<T>(role: Role, path: string, options?: RequestInit): Promise<T> {
  return (await fetchApplication(role, path, options)).json()
}

export const api = {
  list: (role: Role, page: number, status: Status | '', id: string, signal: AbortSignal) =>
    request<Application[]>(role, '?' + new URLSearchParams({ page: String(page), status, id }), { signal }),
  detail: (role: Role, id: string, signal: AbortSignal) => request<Detail>(role, '/' + id, { signal }),
  documents: (role: Role, id: string, signal: AbortSignal) =>
    request<DocumentMetadata[]>(role, '/' + id + '/documents', { signal }),
  upload: (role: Role, id: string, file: File) => {
    const body = new FormData()
    body.append('file', file)
    return request<DocumentMetadata>(role, '/' + id + '/documents', { method: 'POST', body })
  },
  download: async (role: Role, id: string, document: DocumentMetadata) => {
    const response = await fetchApplication(role, '/' + id + '/documents/' + document.id)
    return response.blob()
  },
  submit: (role: Role, submission: Submission, key: string) => request<Application>(role, '', {
    method: 'POST',
    headers: { 'Idempotency-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(submission),
  }),
  act: (role: Role, id: string, action: 'review' | 'decision' | 'permit', approved?: boolean) =>
    request<unknown>(role, '/' + id + '/' + action, {
      method: 'POST',
      ...(approved === undefined ? {} : {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved }),
      }),
    }),
}
