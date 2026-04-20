'use client'

import { useEffect } from 'react'

export default function FormsEditRedirectPage() {
  useEffect(() => {
    const url = new URL('/forms/edit', 'https://liffform-studio.pages.dev')
    const id = new URLSearchParams(window.location.search).get('id')
    if (id) url.searchParams.set('id', id)
    window.location.replace(url.toString())
  }, [])

  return null
}
