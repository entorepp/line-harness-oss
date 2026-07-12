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
  },
}
