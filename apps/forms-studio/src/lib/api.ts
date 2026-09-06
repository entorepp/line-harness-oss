import type {
  ApiResponse,
  Form as HarnessForm,
  FormIssue,
  LineAccount,
  Scenario,
  Tag,
} from '@line-crm/shared'

const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL
export const API_URL = configuredApiUrl !== undefined
  ? configuredApiUrl
  : process.env.NODE_ENV === 'development'
    ? 'http://localhost:8787'
    : ''
export const AUTH_STORAGE_KEY = 'forms_studio_api_key'
export const ACCOUNT_STORAGE_KEY = 'forms_studio_line_account_id'
export const OPERATOR_STORAGE_KEY = 'forms_studio_operator_name'
export const OPERATOR_KEY_SESSION_STORAGE_KEY = 'forms_studio_operator_personal_key'

export type FormResponseEmailRecipient = {
  id: string
  submissionId: string
  role: 'respondent' | 'agency_contact'
  companyName: string | null
  contactName: string
  email: string
  maskedEmail: string
  source: 'staff_registered' | 'staff_corrected'
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
}

export type FormResponseEmailDelivery = {
  id: string
  batchId: string
  submissionId: string
  recipientId: string
  status: 'pending' | 'accepted' | 'failed' | 'unknown'
  provider: string
  providerMessageId: string | null
  errorCode: string | null
  requestedBy: string
  requestedAt: string
  acceptedAt: string | null
  updatedAt: string
  retryOfDeliveryId: string | null
}

export type FormResponseCopyState = {
  submissionHash: string
  emailEnabled: boolean
  providerConfigured: boolean
  recipients: FormResponseEmailRecipient[]
  deliveries: FormResponseEmailDelivery[]
  fields: Array<{
    name: string
    label: string
    type: string
    answered: boolean
    attachmentExcluded: boolean
  }>
}

export type FormResponseCopyPreview = {
  submissionHash: string
  previewHash: string
  policyVersion: string
  recipients: Array<{
    recipientId: string
    role: 'respondent' | 'agency_contact'
    contactName: string
    companyName: string | null
    email: string
    subject: string
    text: string
    includedFieldNames: string[]
  }>
}

let hasRedirectedForUnauthorized = false

export function normalizeApiKey(value: string): string {
  return value.trim().replace(/^Bearer\s+/i, '')
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function getApiKey(): string {
  if (typeof window !== 'undefined') {
    return normalizeApiKey(localStorage.getItem(AUTH_STORAGE_KEY) || '')
  }
  return normalizeApiKey(process.env.NEXT_PUBLIC_API_KEY || '')
}

function handleUnauthorized() {
  if (typeof window === 'undefined' || hasRedirectedForUnauthorized) return

  hasRedirectedForUnauthorized = true
  localStorage.removeItem(AUTH_STORAGE_KEY)
  localStorage.removeItem(ACCOUNT_STORAGE_KEY)
  localStorage.removeItem(OPERATOR_STORAGE_KEY)
  sessionStorage.removeItem(OPERATOR_KEY_SESSION_STORAGE_KEY)

  if (window.location.pathname !== '/login') {
    window.location.assign('/login')
  }
}

async function resolveErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json() as { error?: unknown }
    if (typeof body.error === 'string' && body.error.trim()) {
      return body.error
    }
  } catch {
    // Ignore non-JSON error responses and fall back to the status.
  }

  return `API error: ${res.status}`
}

export async function fetchApi<T>(
  path: string,
  options?: RequestInit & { rawBody?: boolean },
): Promise<T> {
  const { rawBody, ...fetchOptions } = options || {}
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getApiKey()}`,
  }
  if (typeof window !== 'undefined') {
    const operator = localStorage.getItem(OPERATOR_STORAGE_KEY)?.trim()
    if (operator) headers['X-Forms-Operator'] = encodeURIComponent(operator)
    const operatorKey = sessionStorage.getItem(OPERATOR_KEY_SESSION_STORAGE_KEY)?.trim()
    if (operatorKey) headers['X-Forms-Operator-Key'] = operatorKey
  }

  if (!rawBody) {
    headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...fetchOptions,
    headers: {
      ...headers,
      ...fetchOptions?.headers,
    },
  })

  if (!res.ok) {
    const message = await resolveErrorMessage(res)
    if (res.status === 401) {
      handleUnauthorized()
    }
    throw new ApiError(res.status, message)
  }

  return res.json() as Promise<T>
}

export const api = {
  lineAccounts: {
    list: () => fetchApi<ApiResponse<LineAccount[]>>('/api/line-accounts'),
  },
  tags: {
    list: () => fetchApi<ApiResponse<Tag[]>>('/api/tags'),
  },
  scenarios: {
    list: (params?: { accountId?: string }) => {
      const query = params?.accountId ? `?lineAccountId=${params.accountId}` : ''
      return fetchApi<ApiResponse<Scenario[]>>(`/api/scenarios${query}`)
    },
  },
  forms: {
    list: () => fetchApi<ApiResponse<HarnessForm[]>>('/api/forms'),
    get: (id: string) => fetchApi<ApiResponse<HarnessForm>>(`/api/forms/${id}`),
    create: (data: {
      name: string
      description?: string | null
      fields: HarnessForm['fields']
      locale?: string | null
      translationGroupId?: string | null
      submitButtonLabel?: string | null
      successTitle?: string | null
      successDescription?: string | null
      onSubmitTagId?: string | null
      onSubmitScenarioId?: string | null
      saveToMetadata?: boolean
    }) =>
      fetchApi<ApiResponse<HarnessForm>>('/api/forms', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<{
      name: string
      description: string | null
      fields: HarnessForm['fields']
      locale: string | null
      translationGroupId: string | null
      submitButtonLabel: string | null
      successTitle: string | null
      successDescription: string | null
      onSubmitTagId: string | null
      onSubmitScenarioId: string | null
      saveToMetadata: boolean
      isActive: boolean
    }>) =>
      fetchApi<ApiResponse<HarnessForm>>(`/api/forms/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/forms/${id}`, {
        method: 'DELETE',
      }),
    shareUrl: (
      id: string,
      params?: {
        lineAccountId?: string
        sharedByFriendId?: string | null
        slackChannelId?: string | null
      },
    ) => {
      const query = new URLSearchParams()
      if (params?.lineAccountId) query.set('lineAccountId', params.lineAccountId)
      if (params?.sharedByFriendId) query.set('sharedByFriendId', params.sharedByFriendId)
      if (params?.slackChannelId) query.set('slackChannelId', params.slackChannelId)
      const qs = query.toString()
      return fetchApi<ApiResponse<{ shareUrl: string }>>(
        `/api/forms/${id}/share-url${qs ? `?${qs}` : ''}`,
      )
    },
    submissions: (id: string) =>
      fetchApi<ApiResponse<{
        id: string
        formId: string
        formIssueId: string | null
        friendId: string | null
        slackChannelId: string | null
        data: Record<string, unknown>
        createdAt: string
      }[]>>(`/api/forms/${id}/submissions`),
    updateSubmission: (
      submissionId: string,
      data: {
        slackChannelId?: string | null
      },
    ) =>
      fetchApi<ApiResponse<{
        id: string
        formId: string
        formIssueId: string | null
        friendId: string | null
        slackChannelId: string | null
        data: Record<string, unknown>
        createdAt: string
      }>>(`/api/form-submissions/${submissionId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    issues: (id: string) =>
      fetchApi<ApiResponse<(FormIssue & {
        publicUrl: string
        liffUrl: string | null
      })[]>>(`/api/forms/${id}/issues`),
    createIssue: (
      id: string,
      data: {
        name?: string
        lineAccountId?: string | null
        slackChannelId?: string | null
        sharedByFriendId?: string | null
        locale?: string | null
      },
    ) =>
      fetchApi<ApiResponse<FormIssue & {
        publicUrl: string
        liffUrl: string | null
      }>>(`/api/forms/${id}/issues`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateIssue: (
      issueId: string,
      data: Partial<{
        name: string
        lineAccountId: string | null
        slackChannelId: string | null
        sharedByFriendId: string | null
        locale: string | null
        isActive: boolean
      }>,
    ) =>
      fetchApi<ApiResponse<FormIssue & {
        publicUrl: string
        liffUrl: string | null
      }>>(`/api/form-issues/${issueId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    publicIssue: (issueId: string) =>
      fetchApi<ApiResponse<{
        issue: FormIssue & {
          publicUrl: string
          liffUrl: string | null
        }
        form: HarnessForm
      }>>(`/api/form-issues/${issueId}`),
    responseCopy: (submissionId: string) =>
      fetchApi<ApiResponse<FormResponseCopyState>>(
        `/api/form-submissions/${submissionId}/response-copy`,
      ),
    saveEmailRecipient: (
      submissionId: string,
      data: {
        id?: string
        role: 'respondent' | 'agency_contact'
        companyName?: string | null
        contactName: string
        email: string
        emailConfirmation: string
        expectedSubmissionHash: string
        correctionReason?: string
      },
    ) => fetchApi<ApiResponse<FormResponseEmailRecipient>>(
      `/api/form-submissions/${submissionId}/email-recipients`,
      { method: 'POST', body: JSON.stringify(data) },
    ),
    removeEmailRecipient: (submissionId: string, recipientId: string) =>
      fetchApi<ApiResponse<null>>(
        `/api/form-submissions/${submissionId}/email-recipients/${recipientId}`,
        { method: 'DELETE' },
      ),
    previewResponseCopy: (
      submissionId: string,
      data: { recipientIds: string[]; agencyIncludedFieldNames: string[] },
    ) => fetchApi<ApiResponse<FormResponseCopyPreview>>(
      `/api/form-submissions/${submissionId}/response-copy/preview`,
      { method: 'POST', body: JSON.stringify(data) },
    ),
    sendResponseCopy: (
      submissionId: string,
      data: {
        recipientIds: string[]
        agencyIncludedFieldNames: string[]
        expectedSubmissionHash: string
        expectedPreviewHash: string
        idempotencyKey: string
        confirmed: boolean
        agencySharingConfirmed: boolean
      },
    ) => fetchApi<ApiResponse<{
      batchId: string
      results: Array<{
        recipientId: string
        maskedEmail: string
        status: 'accepted' | 'failed' | 'unknown'
        errorCode?: string
        deduplicated: boolean
      }>
    }>>(
      `/api/form-submissions/${submissionId}/response-copy/send`,
      { method: 'POST', body: JSON.stringify(data) },
    ),
  },
}
