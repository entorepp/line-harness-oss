'use client'

import { useEffect } from 'react'

export default function PublicFormRedirectPage() {
  useEffect(() => {
    const url = new URL('/public-form', 'https://liffform-studio.pages.dev')
    new URLSearchParams(window.location.search).forEach((value, key) => {
      url.searchParams.append(key, value)
    })
    window.location.replace(url.toString())
  }, [])

  return null
}
