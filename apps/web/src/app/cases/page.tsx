'use client'

import { useEffect } from 'react'

import Header from '@/components/layout/header'

const flatworkerCasesUrl = 'https://travelworker-web.pages.dev/cases'

export default function CasesPage() {
  useEffect(() => {
    window.location.replace(flatworkerCasesUrl)
  }, [])

  return (
    <div className="min-h-[calc(100vh-8rem)]">
      <Header
        title="案件一覧"
        description="FlatWorkerの案件一覧へ移動しています"
      />

      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm text-gray-600">自動で移動しない場合は、下のリンクを開いてください。</p>
        <a
          href={flatworkerCasesUrl}
          className="mt-4 inline-flex items-center rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          FlatWorkerを開く
        </a>
      </div>
    </div>
  )
}
