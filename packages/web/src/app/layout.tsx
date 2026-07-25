import type { ReactNode } from 'react'
import { Space_Grotesk, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google'
import Link from 'next/link'
import { BRAND_NAME } from '@forked/shared'
import { copy } from '../copy'
import './globals.css'

const display = Space_Grotesk({ subsets: ['latin'], variable: '--font-display' })
const body = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-body' })
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono' })

const siteOrigin = process.env.NEXT_PUBLIC_SITE_ORIGIN ?? 'http://localhost:3000'

export const metadata = {
  metadataBase: new URL(siteOrigin),
  title: BRAND_NAME,
  description: copy.sub,
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        {/* The only persistent nav: the wordmark, linking home. */}
        <header className="site-header">
          <Link className="wordmark" href="/">
            {BRAND_NAME}
          </Link>
        </header>
        {children}
      </body>
    </html>
  )
}
