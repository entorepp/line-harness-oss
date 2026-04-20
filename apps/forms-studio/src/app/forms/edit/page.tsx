'use client'

import { useSearchParams } from 'next/navigation'
import FormBuilder from '@/components/forms/form-builder'

export default function EditFormPage() {
  const searchParams = useSearchParams()
  const formId = searchParams.get('id') ?? undefined

  return <FormBuilder formId={formId} />
}
