import { ImageResponse } from 'next/og'
import { BRAND_NAME } from '@forked/shared'

// One branded image for the whole site. It used to be generated per job from
// that job's card; with the card gone the image is identical for every URL, so
// it lives at the root instead — that way '/', '/about', '/u/*' and every '/j/*'
// route unfurl branded rather than only the job pages. metadataBase (layout.tsx)
// resolves it against NEXT_PUBLIC_SITE_ORIGIN.
export const alt = 'forked'
// 1200x630 is the OpenGraph standard; the old 1080x1350 was a share-card aspect
// and crops badly in a link preview.
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function Image() {
  // A3: colors intentionally frozen pre-redesign — @vercel/og resolves no CSS
  // variables, so these are the literal values, not --void/--bone.
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          background: '#0B0C10',
          color: '#E8E4D9',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 96,
          letterSpacing: 8,
          fontWeight: 700,
        }}
      >
        {BRAND_NAME.toUpperCase()}
      </div>
    ),
    size,
  )
}
