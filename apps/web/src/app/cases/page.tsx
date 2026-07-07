'use client'

import Header from '@/components/layout/header'

const flatworkerCasesUrl =
  process.env.NEXT_PUBLIC_FLATWORKER_CASES_URL || 'https://flatworker.flatcare.jp/cases'

export default function CasesPage() {
  return (
    <div className="min-h-[calc(100vh-8rem)]">
      <Header
        title="案件一覧"
        description="案件ステータスと見積作成を管理します"
        action={
          <a
            href={flatworkerCasesUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 3h7m0 0v7m0-7L10 14m-4-4v10h10" />
            </svg>
            別タブで開く
          </a>
        }
      />

      <div className="h-[calc(100vh-13rem)] min-h-[680px] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <iframe
          src={flatworkerCasesUrl}
          title="FlatWorker 案件一覧"
          className="h-full w-full border-0"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
    </div>
  )
}
