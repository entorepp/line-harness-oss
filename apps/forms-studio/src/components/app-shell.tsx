'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import AuthGuard from '@/components/auth-guard'
import { ACCOUNT_STORAGE_KEY, AUTH_STORAGE_KEY } from '@/lib/api'

function StudioNav() {
  const pathname = usePathname()
  const router = useRouter()

  const logout = () => {
    localStorage.removeItem(AUTH_STORAGE_KEY)
    localStorage.removeItem(ACCOUNT_STORAGE_KEY)
    router.replace('/login')
  }

  const navItems = [
    { href: '/', label: 'Dashboard' },
    { href: '/forms/new', label: 'New Form' },
  ]

  return (
    <header className="sticky top-0 z-30 border-b border-[#d9d2eb] bg-[#f0ebf8]/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#673ab7] text-sm font-semibold text-white shadow-sm">
              LF
            </span>
            <span>
              <span className="block text-sm font-semibold tracking-[0.18em] text-[#6c52be]">
                GOOGLE-FORM STYLE
              </span>
              <span className="block text-lg font-semibold text-[#202124]">LIFFForm Studio</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-2 md:flex">
            {navItems.map((item) => {
              const active = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-[#673ab7] text-white'
                      : 'text-slate-600 hover:bg-white hover:text-slate-950'
                  }`}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </div>

        <button
          type="button"
          onClick={logout}
          className="rounded-full border border-[#d9d2eb] bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-[#c8bde6] hover:bg-[#faf7fe]"
        >
          Logout
        </button>
      </div>
    </header>
  )
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  if (pathname === '/login' || pathname === '/public-form') {
    return <>{children}</>
  }

  return (
    <AuthGuard>
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,#f8f5fe,#f0ebf8_42%,#ebe4f8)] text-slate-950">
        <StudioNav />
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
      </div>
    </AuthGuard>
  )
}
