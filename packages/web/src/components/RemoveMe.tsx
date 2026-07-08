'use client'

import { useState } from 'react'
import { copy } from '../copy'
import { postLeaderboardRemove } from '../lib/api'

// Opt-out form for the leaderboard. Unauthenticated on purpose: the board
// only shows public chess.com data, and this can only hide an entry.
export function RemoveMe() {
  const [name, setName] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')

  async function remove(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || state === 'busy') return
    setState('busy')
    setState((await postLeaderboardRemove(name.trim())) ? 'done' : 'error')
  }

  if (state === 'done') return <p className="quiet">{copy.leader.removeDone}</p>

  return (
    <form className="remove-row" onSubmit={remove}>
      <input
        className="field"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={copy.leader.removePlaceholder}
        aria-label={copy.leader.removePlaceholder}
      />
      <button className="row-analyze" type="submit" disabled={state === 'busy'}>
        {state === 'busy' ? copy.leader.removeBusy : copy.leader.removeCta}
      </button>
      {state === 'error' && (
        <p className="inline-error" role="alert">
          {copy.errors.generic}
        </p>
      )}
    </form>
  )
}
