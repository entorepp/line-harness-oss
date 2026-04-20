import type {
  ApiResponse,
  Form as HarnessForm,
  FormIssue,
  LineAccount,
  Scenario,
  Tag,
} from '@line-crm/shared'

export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787'
export const AUTH_STORAGE_KEY = 'forms_studio_api_key'
export const ACCOUNT_STORAGE_KEY = 'forms_studio_line_account_id'

function getApiKey(): string {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(AUTH_STORAGE_KEY) || ''
  }
  return process.env.NEXT_PUBLIC_API_KEY || ''
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
    throw new Error(`API error: ${res.status}`)
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
