'use client'

import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { api } from '@/lib/api'
import type { ChannelType } from '@/lib/api'

const STORAGE_KEY = 'lh_selected_account'

export interface AccountWithStats {
  id: string
  channelId: string
  name: string
  displayName?: string
  pictureUrl?: string
  basicId?: string
  channelType?: ChannelType
  locale?: string
  defaultSlackChannel?: string | null
  isActive: boolean
  stats?: {
    friendCount: number
    activeScenarios: number
    messagesThisMonth: number
  }
}

interface AccountContextValue {
  accounts: AccountWithStats[]
  selectedAccountId: string | null
  selectedAccount: AccountWithStats | null
  setSelectedAccountId: (id: string) => void
  refreshAccounts: () => Promise<void>
  loading: boolean
}

const AccountContext = createContext<AccountContextValue | null>(null)

function hasVisibleData(account: AccountWithStats): boolean {
  return (account.stats?.friendCount ?? 0) > 0 || (account.stats?.messagesThisMonth ?? 0) > 0
}

function preferredAccountRank(account: AccountWithStats): number {
  const name = `${account.displayName || ''} ${account.name || ''}`.toLowerCase()
  if (account.channelType === 'line' && (name.includes('フラット') || name.includes('flat travel'))) return 0
  if (account.channelType === 'line') return 1
  if (account.channelType === 'whatsapp') return 2
  return 3
}

function findPreferredVisibleAccount(accounts: AccountWithStats[]): AccountWithStats | undefined {
  return accounts
    .filter(hasVisibleData)
    .sort((left, right) => preferredAccountRank(left) - preferredAccountRank(right))[0]
}

function selectDefaultAccountId(accounts: AccountWithStats[], storedId: string | null): string {
  const storedAccount = storedId ? accounts.find((account) => account.id === storedId) : null
  if (storedAccount && hasVisibleData(storedAccount)) return storedAccount.id

  return findPreferredVisibleAccount(accounts)?.id ?? accounts[0].id
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<AccountWithStats[]>([])
  const [selectedAccountId, setSelectedAccountIdState] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const setSelectedAccountId = useCallback((id: string) => {
    setSelectedAccountIdState(id)
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      // localStorage unavailable
    }
  }, [])

  const refreshAccounts = useCallback(async () => {
    try {
      const res = await api.lineAccounts.list()
      if (res.success && res.data.length > 0) {
        const list = res.data as AccountWithStats[]
        setAccounts(list)

        // If current selection is invalid (e.g. deleted), fall back to first
        setSelectedAccountIdState((prev) => {
          if (prev) {
            const previousAccount = list.find((a) => a.id === prev)
            const fallbackAccount = findPreferredVisibleAccount(list)
            if (previousAccount && (hasVisibleData(previousAccount) || !fallbackAccount)) return prev
          }
          // Restore from localStorage unless it points to an empty setup-only channel.
          let stored: string | null = null
          try {
            stored = localStorage.getItem(STORAGE_KEY)
          } catch {
            // localStorage unavailable
          }
          const nextId = selectDefaultAccountId(list, stored)
          try {
            localStorage.setItem(STORAGE_KEY, nextId)
          } catch {
            // localStorage unavailable
          }
          return nextId
        })
      } else {
        setAccounts([])
        setSelectedAccountIdState(null)
      }
    } catch {
      // Failed to load accounts
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshAccounts()
  }, [refreshAccounts])

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? null

  return (
    <AccountContext.Provider
      value={{ accounts, selectedAccountId, selectedAccount, setSelectedAccountId, refreshAccounts, loading }}
    >
      {children}
    </AccountContext.Provider>
  )
}

export function useAccount(): AccountContextValue {
  const ctx = useContext(AccountContext)
  if (!ctx) throw new Error('useAccount must be used within AccountProvider')
  return ctx
}
