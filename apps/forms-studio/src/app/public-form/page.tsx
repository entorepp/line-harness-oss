import { Suspense } from 'react'
import PublicFormPage from '@/components/forms/public-form-page'

export default function PublicFormRoute() {
  return (
    <Suspense
      fallback={(
        <main className="min-h-screen bg-[radial-gradient(circle_at_top,#effaf3,white_50%)] px-4 py-10 sm:px-6">
          <div className="mx-auto max-w-2xl rounded-3xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-400 shadow-sm">
            読み込み中...
          </div>
        </main>
      )}
    >
      <PublicFormPage />
    </Suspense>
  )
}
