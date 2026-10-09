'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ensureStudioSession } from '@/lib/api'

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    if (pathname === '/login') {
      setChecked(true)
      return
    }

    let active = true
    ensureStudioSession().then(() => { if (active) setChecked(true) })
      .catch(() => { if (active) router.replace('/login') })
    return () => { active = false }
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
