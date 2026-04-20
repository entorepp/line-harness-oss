import type { Metadata } from 'next'
import './globals.css'
import AppShell from '@/components/app-shell'

export const metadata: Metadata = {
  title: 'LIFFForm Studio',
  description: 'フォーム作成・共有・公開回答をまとめて管理する独立ツール',
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/favicon.svg',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja">
      <body
        className="antialiased"
        style={{ fontFamily: "'Google Sans', 'Noto Sans JP', 'Roboto', 'Hiragino Sans', 'Yu Gothic', system-ui, sans-serif" }}
      >
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
