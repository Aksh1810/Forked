import type { ReactNode } from 'react'
import { BRAND_NAME } from '@blunderfarm/shared'

export const metadata = {
  title: BRAND_NAME,
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#0B0C10', color: '#E8E4D9' }}>{children}</body>
    </html>
  )
}
