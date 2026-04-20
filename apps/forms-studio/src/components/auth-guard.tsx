'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { AUTH_STORAGE_KEY } from '@/lib/api'

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    if (pathname === '/login') {
      setChecked(true)
      return
    }

    const apiKey = localStorage.getItem(AUTH_STORAGE_KEY)
    if (!apiKey) {
      router.replace('/login')
      return
    }

    setChecked(true)
  }, [pathname, router])

  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#e4efe7,#f7faf7_50%,#eef3ef)]">
        <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-emerald-100 border-t-emerald-600" />
      </div>
    )
  }

  return <>{children}</>
}
