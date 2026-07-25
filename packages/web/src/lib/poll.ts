// Every surface that watches a job hand-rolled the same loop: a `stop` flag, a
// recursive setTimeout, a clearTimeout on unmount, and a check after each
// await so a late response can't write into a component that has gone away.
// That loop lives here now; what stays with each caller is the part that is
// genuinely different — what it fetches, what it does with the result, and how
// long it waits.
//
// The result of an in-flight fetch that lands after cancellation is dropped:
// `onResult` is never called once the returned cancel function has run.
export function poll<T>(
  fetchOnce: () => Promise<T>,
  onResult: (value: T) => 'again' | 'done',
  delayMs: (elapsedMs: number) => number,
): () => void {
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const startedAt = Date.now()

  async function run(): Promise<void> {
    const value = await fetchOnce()
    if (cancelled) return
    if (onResult(value) === 'done') return
    if (cancelled) return
    timer = setTimeout(() => void run(), delayMs(Date.now() - startedAt))
  }

  void run()

  return () => {
    cancelled = true
    clearTimeout(timer)
  }
}
