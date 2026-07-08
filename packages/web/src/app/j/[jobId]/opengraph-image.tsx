import { ImageResponse } from 'next/og'
import { getJob } from '../../../lib/api'
import { CARD_SIZES, renderCard } from '../../../lib/card-image'

// The job URL's OpenGraph image IS the 4:5 card, generated per job. A shared
// link unfurls into that user's own card, never a generic banner.
export const alt = 'forked card'
export const size = CARD_SIZES['4x5']
export const contentType = 'image/png'

export default async function Image({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  const job = await getJob(jobId).catch(() => null)
  const origin = process.env.NEXT_PUBLIC_SITE_ORIGIN ?? 'forked.local'
  if (!job?.wrapped) {
    // A job still analyzing (or missing) gets a plain branded fallback rather
    // than a broken image; a finished job always unfurls its real card.
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
            fontSize: 64,
            letterSpacing: 6,
            fontWeight: 700,
          }}
        >
          FORKED
        </div>
      ),
      size,
    )
  }
  return renderCard(job.wrapped, '4x5', origin)
}
