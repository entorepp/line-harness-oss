import type {
  Friend,
  Tag,
  Scenario,
  ScenarioStep,
  ApiResponse,
  PaginatedResponse,
  User,
  LineAccount,
  ConversionPoint,
  Affiliate,
  Template,
  Automation,
  AutomationLog,
  Chat,
  Reminder,
  ReminderStep,
  ScoringRule,
  IncomingWebhook,
  OutgoingWebhook,
  NotificationRule,
  Notification,
  AccountHealthLog,
  AccountMigration,
  Form as HarnessForm,
} from '@line-crm/shared'

import type { Broadcast } from '@line-crm/shared'

/** Broadcast type from API (now camelCase after worker serialization) */
export type ApiBroadcast = Broadcast

export type ApiScheduledMessage = {
  id: string
  friendId: string
  chatId: string | null
  messageType: string
  content: string
  metadata: string | null
  scheduledAt: string
  status: 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled'
  sentAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export type ApiSendMessageResult = {
  sent?: boolean
  messageId?: string
  scheduled?: boolean
  scheduledMessage?: ApiScheduledMessage
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787'

/**
 * Read the API key from localStorage first (set during login), falling back to
 * the build-time env var for local development without the login page.
 */
function getApiKey(): string {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('lh_api_key')
    if (stored) return stored
  }
  return process.env.NEXT_PUBLIC_API_KEY || ''
}

export async function fetchApi<T>(path: string, options?: RequestInit & { rawBody?: boolean }): Promise<T> {
  const { rawBody, ...fetchOptions } = options || {}
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${getApiKey()}`,
  }
  // Don't set Content-Type for FormData (browser sets it with boundary automatically)
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
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json() as Promise<T>
}

export type FriendListParams = {
  offset?: string
  limit?: string
  tagId?: string
  accountId?: string
}

export type FriendWithTags = Friend & { tags: Tag[] }

export const api = {
  friends: {
    list: (params?: FriendListParams) => {
      const query: Record<string, string> = {}
      if (params?.offset) query.offset = params.offset
      if (params?.limit) query.limit = params.limit
      if (params?.tagId) query.tagId = params.tagId
      if (params?.accountId) query.lineAccountId = params.accountId
      return fetchApi<ApiResponse<PaginatedResponse<FriendWithTags>>>(
        '/api/friends?' + new URLSearchParams(query)
      )
    },
    get: (id: string) =>
      fetchApi<ApiResponse<FriendWithTags>>(`/api/friends/${id}`),
    count: (params?: { accountId?: string }) => {
      const query = params?.accountId ? '?lineAccountId=' + params.accountId : ''
      return fetchApi<ApiResponse<{ count: number }>>('/api/friends/count' + query)
    },
    addTag: (friendId: string, tagId: string) =>
      fetchApi<ApiResponse<null>>(`/api/friends/${friendId}/tags`, {
        method: 'POST',
        body: JSON.stringify({ tagId }),
      }),
    removeTag: (friendId: string, tagId: string) =>
      fetchApi<ApiResponse<null>>(`/api/friends/${friendId}/tags/${tagId}`, {
        method: 'DELETE',
      }),
    sendMessage: (friendId: string, data: Record<string, string | null | undefined>) =>
      fetchApi<ApiResponse<ApiSendMessageResult>>(`/api/friends/${friendId}/messages`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    listScheduledMessages: (friendId: string) =>
      fetchApi<ApiResponse<ApiScheduledMessage[]>>(`/api/friends/${friendId}/scheduled-messages`),
  },
  tags: {
    list: () =>
      fetchApi<ApiResponse<Tag[]>>('/api/tags'),
    create: (data: { name: string; color: string }) =>
      fetchApi<ApiResponse<Tag>>('/api/tags', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/tags/${id}`, { method: 'DELETE' }),
  },
  scenarios: {
    list: (params?: { accountId?: string }) => {
      const query = params?.accountId ? '?lineAccountId=' + params.accountId : ''
      return fetchApi<ApiResponse<(Scenario & { stepCount?: number })[]>>('/api/scenarios' + query)
    },
    get: (id: string) =>
      fetchApi<ApiResponse<Scenario & { steps: ScenarioStep[] }>>(`/api/scenarios/${id}`),
    create: (data: Omit<Scenario, 'id' | 'createdAt' | 'updatedAt'> & { lineAccountId?: string; triggerData?: string | null }) =>
      fetchApi<ApiResponse<Scenario>>('/api/scenarios', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<Omit<Scenario, 'id' | 'createdAt' | 'updatedAt'>>) =>
      fetchApi<ApiResponse<Scenario>>(`/api/scenarios/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/scenarios/${id}`, { method: 'DELETE' }),
    addStep: (id: string, data: Omit<ScenarioStep, 'id' | 'scenarioId' | 'createdAt'>) =>
      fetchApi<ApiResponse<ScenarioStep>>(`/api/scenarios/${id}/steps`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateStep: (
      id: string,
      stepId: string,
      data: Partial<Omit<ScenarioStep, 'id' | 'scenarioId' | 'createdAt'>>
    ) =>
      fetchApi<ApiResponse<ScenarioStep>>(`/api/scenarios/${id}/steps/${stepId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    deleteStep: (id: string, stepId: string) =>
      fetchApi<ApiResponse<null>>(`/api/scenarios/${id}/steps/${stepId}`, {
        method: 'DELETE',
      }),
  },
  broadcasts: {
    list: (params?: { accountId?: string }) => {
      const query = params?.accountId ? '?lineAccountId=' + params.accountId : ''
      return fetchApi<ApiResponse<ApiBroadcast[]>>('/api/broadcasts' + query)
    },
    get: (id: string) =>
      fetchApi<ApiResponse<ApiBroadcast>>(`/api/broadcasts/${id}`),
    create: (data: {
      title: string
      messageType: ApiBroadcast['messageType']
      messageContent: string
      targetType: ApiBroadcast['targetType']
      targetTagId?: string | null
      scheduledAt?: string | null
      status?: ApiBroadcast['status']
    }) =>
      fetchApi<ApiResponse<ApiBroadcast>>('/api/broadcasts', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (
      id: string,
      data: {
        title?: string
        messageType?: ApiBroadcast['messageType']
        messageContent?: string
        targetType?: ApiBroadcast['targetType']
        targetTagId?: string | null
        scheduledAt?: string | null
      }
    ) =>
      fetchApi<ApiResponse<ApiBroadcast>>(`/api/broadcasts/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/broadcasts/${id}`, { method: 'DELETE' }),
    send: (id: string) =>
      fetchApi<ApiResponse<ApiBroadcast>>(`/api/broadcasts/${id}/send`, { method: 'POST' }),
  },

  // ── Round 2 APIs ─────────────────────────────────────────────────────────
  users: {
    list: () =>
      fetchApi<ApiResponse<User[]>>('/api/users'),
    get: (id: string) =>
      fetchApi<ApiResponse<User>>(`/api/users/${id}`),
    create: (data: { email?: string | null; phone?: string | null; externalId?: string | null; displayName?: string | null }) =>
      fetchApi<ApiResponse<User>>('/api/users', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<Pick<User, 'email' | 'phone' | 'externalId' | 'displayName'>>) =>
      fetchApi<ApiResponse<User>>(`/api/users/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/users/${id}`, { method: 'DELETE' }),
    link: (userId: string, friendId: string) =>
      fetchApi<ApiResponse<null>>(`/api/users/${userId}/link`, {
        method: 'POST',
        body: JSON.stringify({ friendId }),
      }),
    accounts: (userId: string) =>
      fetchApi<ApiResponse<{ id: string; lineUserId: string; displayName: string | null; isFollowing: boolean }[]>>(
        `/api/users/${userId}/accounts`,
      ),
  },
  lineAccounts: {
    list: () =>
      fetchApi<ApiResponse<LineAccount[]>>('/api/line-accounts'),
    get: (id: string) =>
      fetchApi<ApiResponse<LineAccount>>(`/api/line-accounts/${id}`),
    create: (data: {
      channelId: string
      name: string
      channelAccessToken: string
      channelSecret?: string
      channelType?: 'line' | 'whatsapp'
      locale?: string
      defaultSlackChannel?: string | null
    }) =>
      fetchApi<ApiResponse<LineAccount>>('/api/line-accounts', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<Pick<LineAccount, 'name' | 'channelAccessToken' | 'channelSecret' | 'channelType' | 'locale' | 'defaultSlackChannel' | 'isActive'>>) =>
      fetchApi<ApiResponse<LineAccount>>(`/api/line-accounts/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/line-accounts/${id}`, { method: 'DELETE' }),
  },
  conversions: {
    points: () =>
      fetchApi<ApiResponse<ConversionPoint[]>>('/api/conversions/points'),
    createPoint: (data: { name: string; eventType: string; value?: number | null }) =>
      fetchApi<ApiResponse<ConversionPoint>>('/api/conversions/points', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    deletePoint: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/conversions/points/${id}`, { method: 'DELETE' }),
    track: (data: { conversionPointId: string; friendId: string; userId?: string | null; affiliateCode?: string | null; metadata?: Record<string, unknown> | null }) =>
      fetchApi<ApiResponse<unknown>>('/api/conversions/track', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    report: (params?: { startDate?: string; endDate?: string }) =>
      fetchApi<ApiResponse<{ conversionPointId: string; conversionPointName: string; eventType: string; totalCount: number; totalValue: number }[]>>(
        '/api/conversions/report?' + new URLSearchParams(params as Record<string, string>),
      ),
  },
  affiliates: {
    list: () =>
      fetchApi<ApiResponse<Affiliate[]>>('/api/affiliates'),
    get: (id: string) =>
      fetchApi<ApiResponse<Affiliate>>(`/api/affiliates/${id}`),
    create: (data: { name: string; code: string; commissionRate?: number }) =>
      fetchApi<ApiResponse<Affiliate>>('/api/affiliates', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<Pick<Affiliate, 'name' | 'commissionRate' | 'isActive'>>) =>
      fetchApi<ApiResponse<Affiliate>>(`/api/affiliates/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/affiliates/${id}`, { method: 'DELETE' }),
    report: (id: string, params?: { startDate?: string; endDate?: string }) =>
      fetchApi<ApiResponse<{ affiliateId: string; affiliateName: string; code: string; commissionRate: number; totalClicks: number; totalConversions: number; totalRevenue: number }>>(
        `/api/affiliates/${id}/report?` + new URLSearchParams(params as Record<string, string>),
      ),
  },
  templates: {
    list: (category?: string) =>
      fetchApi<ApiResponse<{ id: string; name: string; category: string; messageType: string; messageContent: string; createdAt: string; updatedAt: string }[]>>(
        '/api/templates' + (category ? '?' + new URLSearchParams({ category }) : ''),
      ),
    get: (id: string) =>
      fetchApi<ApiResponse<{ id: string; name: string; category: string; messageType: string; messageContent: string; createdAt: string; updatedAt: string }>>(
        `/api/templates/${id}`,
      ),
    create: (data: { name: string; category: string; messageType: string; messageContent: string }) =>
      fetchApi<ApiResponse<{ id: string; name: string; category: string; messageType: string; messageContent: string; createdAt: string; updatedAt: string }>>(
        '/api/templates',
        { method: 'POST', body: JSON.stringify(data) },
      ),
    update: (id: string, data: Partial<{ name: string; category: string; messageType: string; messageContent: string }>) =>
      fetchApi<ApiResponse<{ id: string; name: string; category: string; messageType: string; messageContent: string; createdAt: string; updatedAt: string }>>(
        `/api/templates/${id}`,
        { method: 'PUT', body: JSON.stringify(data) },
      ),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/templates/${id}`, { method: 'DELETE' }),
  },
  forms: {
    list: () =>
      fetchApi<ApiResponse<HarnessForm[]>>('/api/forms'),
    get: (id: string) =>
      fetchApi<ApiResponse<HarnessForm>>(`/api/forms/${id}`),
    create: (data: {
      name: string
      description?: string | null
      fields: HarnessForm['fields']
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
    shareUrl: (id: string, params?: { lineAccountId?: string; sharedByFriendId?: string | null; slackChannelId?: string | null }) => {
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
      fetchApi<ApiResponse<{ id: string; formId: string; friendId: string | null; data: Record<string, unknown>; createdAt: string }[]>>(
        `/api/forms/${id}/submissions`,
      ),
  },
  automations: {
    list: (params?: { accountId?: string }) => {
      const query = params?.accountId ? '?lineAccountId=' + params.accountId : ''
      return fetchApi<ApiResponse<Automation[]>>('/api/automations' + query)
    },
    get: (id: string) =>
      fetchApi<ApiResponse<Automation & { logs?: AutomationLog[] }>>(`/api/automations/${id}`),
    create: (data: {
      name: string
      eventType: Automation['eventType']
      actions: Automation['actions']
      description?: string | null
      conditions?: Record<string, unknown>
      priority?: number
    }) =>
      fetchApi<ApiResponse<Automation>>('/api/automations', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<Pick<Automation, 'name' | 'description' | 'eventType' | 'conditions' | 'actions' | 'isActive' | 'priority'>>) =>
      fetchApi<ApiResponse<Automation>>(`/api/automations/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/automations/${id}`, { method: 'DELETE' }),
    logs: (id: string, limit?: number) =>
      fetchApi<ApiResponse<AutomationLog[]>>(
        `/api/automations/${id}/logs` + (limit ? `?limit=${limit}` : ''),
      ),
  },
  chats: {
    list: (params?: { status?: string; operatorId?: string; accountId?: string }) => {
      const query: Record<string, string> = {}
      if (params?.status) query.status = params.status
      if (params?.operatorId) query.operatorId = params.operatorId
      if (params?.accountId) query.lineAccountId = params.accountId
      return fetchApi<ApiResponse<Chat[]>>(
        '/api/chats?' + new URLSearchParams(query),
      )
    },
    get: (id: string, params?: { beforeMessageId?: string; limit?: number }) => {
      const query = new URLSearchParams()
      if (params?.beforeMessageId) query.set('beforeMessageId', params.beforeMessageId)
      if (params?.limit) query.set('limit', String(params.limit))
      const suffix = query.toString() ? `?${query.toString()}` : ''
      return fetchApi<ApiResponse<Chat & {
        messages?: {
          id: string
          direction: 'incoming' | 'outgoing'
          messageType: string
          content: string
          createdAt: string
        }[]
        hasMoreMessages?: boolean
        oldestMessageId?: string | null
      }>>(`/api/chats/${id}${suffix}`)
    },
    create: (data: { friendId: string; operatorId?: string | null }) =>
      fetchApi<ApiResponse<Chat>>('/api/chats', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: { operatorId?: string | null; status?: Chat['status']; notes?: string | null }) =>
      fetchApi<ApiResponse<Chat>>(`/api/chats/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    send: (id: string, data: Record<string, string | null | undefined>) =>
      fetchApi<ApiResponse<ApiSendMessageResult>>(`/api/chats/${id}/send`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
  scheduledMessages: {
    update: (id: string, data: { scheduledAt: string }) =>
      fetchApi<ApiResponse<ApiScheduledMessage>>(`/api/scheduled-messages/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    cancel: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/scheduled-messages/${id}`, {
        method: 'DELETE',
      }),
  },
  reminders: {
    list: (params?: { accountId?: string }) => {
      const query = params?.accountId ? '?lineAccountId=' + params.accountId : ''
      return fetchApi<ApiResponse<Reminder[]>>('/api/reminders' + query)
    },
    get: (id: string) =>
      fetchApi<ApiResponse<Reminder & { steps: ReminderStep[] }>>(`/api/reminders/${id}`),
    create: (data: { name: string; description?: string | null }) =>
      fetchApi<ApiResponse<Reminder>>('/api/reminders', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<Pick<Reminder, 'name' | 'description' | 'isActive'>>) =>
      fetchApi<ApiResponse<Reminder>>(`/api/reminders/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/reminders/${id}`, { method: 'DELETE' }),
    addStep: (id: string, data: { offsetMinutes: number; messageType: string; messageContent: string }) =>
      fetchApi<ApiResponse<ReminderStep>>(`/api/reminders/${id}/steps`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    deleteStep: (reminderId: string, stepId: string) =>
      fetchApi<ApiResponse<null>>(`/api/reminders/${reminderId}/steps/${stepId}`, {
        method: 'DELETE',
      }),
  },
  scoring: {
    rules: () =>
      fetchApi<ApiResponse<ScoringRule[]>>('/api/scoring-rules'),
    getRule: (id: string) =>
      fetchApi<ApiResponse<ScoringRule>>(`/api/scoring-rules/${id}`),
    createRule: (data: { name: string; eventType: string; scoreValue: number }) =>
      fetchApi<ApiResponse<ScoringRule>>('/api/scoring-rules', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateRule: (id: string, data: Partial<Pick<ScoringRule, 'name' | 'eventType' | 'scoreValue' | 'isActive'>>) =>
      fetchApi<ApiResponse<ScoringRule>>(`/api/scoring-rules/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    deleteRule: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/scoring-rules/${id}`, { method: 'DELETE' }),
    friendScore: (friendId: string) =>
      fetchApi<ApiResponse<{ totalScore: number; history: { id: string; scoreChange: number; reason: string | null; createdAt: string }[] }>>(
        `/api/friends/${friendId}/score`,
      ),
  },
  webhooks: {
    incoming: {
      list: () =>
        fetchApi<ApiResponse<IncomingWebhook[]>>('/api/webhooks/incoming'),
      create: (data: { name: string; sourceType?: string; secret?: string | null }) =>
        fetchApi<ApiResponse<IncomingWebhook>>('/api/webhooks/incoming', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (id: string, data: Partial<Pick<IncomingWebhook, 'name' | 'sourceType' | 'isActive'>>) =>
        fetchApi<ApiResponse<IncomingWebhook>>(`/api/webhooks/incoming/${id}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        }),
      delete: (id: string) =>
        fetchApi<ApiResponse<null>>(`/api/webhooks/incoming/${id}`, { method: 'DELETE' }),
    },
    outgoing: {
      list: () =>
        fetchApi<ApiResponse<OutgoingWebhook[]>>('/api/webhooks/outgoing'),
      create: (data: { name: string; url: string; eventTypes: string[]; secret?: string | null }) =>
        fetchApi<ApiResponse<OutgoingWebhook>>('/api/webhooks/outgoing', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (id: string, data: Partial<Pick<OutgoingWebhook, 'name' | 'url' | 'eventTypes' | 'isActive'>>) =>
        fetchApi<ApiResponse<OutgoingWebhook>>(`/api/webhooks/outgoing/${id}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        }),
      delete: (id: string) =>
        fetchApi<ApiResponse<null>>(`/api/webhooks/outgoing/${id}`, { method: 'DELETE' }),
    },
  },
  notifications: {
    rules: {
      list: () =>
        fetchApi<ApiResponse<NotificationRule[]>>('/api/notifications/rules'),
      get: (id: string) =>
        fetchApi<ApiResponse<NotificationRule>>(`/api/notifications/rules/${id}`),
      create: (data: { name: string; eventType: string; conditions?: Record<string, unknown>; channels?: string[] }) =>
        fetchApi<ApiResponse<NotificationRule>>('/api/notifications/rules', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (id: string, data: Partial<Pick<NotificationRule, 'name' | 'eventType' | 'conditions' | 'channels' | 'isActive'>>) =>
        fetchApi<ApiResponse<NotificationRule>>(`/api/notifications/rules/${id}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        }),
      delete: (id: string) =>
        fetchApi<ApiResponse<null>>(`/api/notifications/rules/${id}`, { method: 'DELETE' }),
    },
    list: (params?: { status?: string; limit?: string }) =>
      fetchApi<ApiResponse<Notification[]>>(
        '/api/notifications?' + new URLSearchParams(params as Record<string, string>),
      ),
  },
  health: {
    accounts: () =>
      fetchApi<ApiResponse<LineAccount[]>>('/api/line-accounts'),
    getHealth: (accountId: string) =>
      fetchApi<ApiResponse<{ riskLevel: string; logs: AccountHealthLog[] }>>(
        `/api/accounts/${accountId}/health`,
      ),
    migrations: () =>
      fetchApi<ApiResponse<AccountMigration[]>>('/api/accounts/migrations'),
    migrate: (fromAccountId: string, data: { toAccountId: string }) =>
      fetchApi<ApiResponse<AccountMigration>>(`/api/accounts/${fromAccountId}/migrate`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    getMigration: (migrationId: string) =>
      fetchApi<ApiResponse<AccountMigration>>(`/api/accounts/migrations/${migrationId}`),
  },

  // ── Entry Routes (流入経路) ────────────────────────────────────────────
  entryRoutes: {
    list: (params?: { accountId?: string }) => {
      const query = params?.accountId ? '?lineAccountId=' + params.accountId : ''
      return fetchApi<ApiResponse<{ id: string; name: string; refCode: string; description: string | null; tagId: string | null; tagName: string | null; lineAccountId: string | null; trackingUrl: string; isActive: boolean; createdAt: string }[]>>(
        '/api/entry-routes' + query,
      )
    },
    create: (data: { name: string; refCode?: string; description?: string; tagId?: string; lineAccountId?: string }) =>
      fetchApi<ApiResponse<{ id: string; refCode: string }>>('/api/entry-routes', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: { name?: string; description?: string; tagId?: string | null; isActive?: boolean }) =>
      fetchApi<ApiResponse<unknown>>(`/api/entry-routes/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/entry-routes/${id}`, { method: 'DELETE' }),
  },

  // ── Slack linking ──────────────────────────────────────────────────────
  slack: {
    linkFriend: (friendId: string, slackChannelId: string | null) =>
      fetchApi<ApiResponse<unknown>>(`/api/friends/${friendId}/slack`, {
        method: 'PUT',
        body: JSON.stringify({ slackChannelId }),
      }),
    bulkLink: (friendIds: string[], slackChannelId: string) =>
      fetchApi<ApiResponse<unknown>>('/api/friends/bulk-slack', {
        method: 'POST',
        body: JSON.stringify({ friendIds, slackChannelId }),
      }),
  },
}
