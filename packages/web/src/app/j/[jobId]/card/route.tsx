import { getJob } from '../../../../lib/api'
import { CARD_SIZES, renderCard, type CardSize } from '../../../../lib/card-image'

// PNG download endpoint for both card sizes, driving the share row's "Download
// PNG" and "Download story size" actions. Same renderer as the OG image, so a
// downloaded card and an unfurled card are identical.
export async function GET(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  const sizeParam = new URL(req.url).searchParams.get('size')
  const size: CardSize = sizeParam === '9x16' ? '9x16' : '4x5'
  const job = await getJob(jobId).catch(() => null)
  if (!job?.wrapped) return new Response('not finished', { status: 404 })
  const origin = process.env.NEXT_PUBLIC_SITE_ORIGIN ?? 'forked.local'
  void CARD_SIZES
  return renderCard(job.wrapped, size, origin)
}
