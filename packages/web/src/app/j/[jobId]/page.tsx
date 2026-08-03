import { redirect } from 'next/navigation'
import { copy } from '../../../copy'
import { API_BASE, type JobView } from '../../../lib/api'

// A compatibility shim, not a destination. This URL used to be the progress
// page that became the Wrapped story; it was handed to users as their permanent
// link, so those bookmarks are out in the wild. A job now means exactly one
// game, and /u/[username] navigates straight to that game's report — so nothing
// on the happy path lands here. Old links get forwarded to the closest thing
// that still exists: the game if we know it, otherwise the user's games list.
//
// Deliberately a server component, unlike every other page here: it has no
// interactive state, so resolving the job server-side turns the whole thing
// into one redirect response instead of shipping JS that renders a placeholder,
// fetches, and then navigates. `redirect()` signals by throwing, so it has to
// stay outside the try.
export default async function JobRedirect({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params

  let job: JobView | null = null
  try {
    // Timeout, not just no-store: this blocks the SSR response, so a cold or
    // slow control Lambda would turn a graceful legacy-link forward into a 504.
    const res = await fetch(`${API_BASE}/job/${jobId}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    })
    if (res.ok) job = (await res.json()) as JobView
  } catch {
    job = null // unreachable API reads the same as a dead link here
  }

  if (job?.gameId) redirect(`/j/${jobId}/g/${job.gameId}`)
  // Jobs from before the one-game-per-job change carry no gameId.
  if (job?.username) redirect(`/u/${encodeURIComponent(job.username)}`)

  return (
    <main className="flow">
      <p className="quiet">{copy.jobGone}</p>
    </main>
  )
}
