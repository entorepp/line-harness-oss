import type { Metadata } from 'next'
import SharedReportPage from '@/components/forms/shared-report-page'

export const metadata: Metadata = {
  title: 'Accessible Japan Leads | Flat Travel',
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
  referrer: 'no-referrer',
}

export default function Page() {
  return <SharedReportPage />
}
