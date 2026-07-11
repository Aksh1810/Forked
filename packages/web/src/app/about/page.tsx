import Link from 'next/link'
import { BRAND_NAME } from '@forked/shared'

export const metadata = { title: `about | ${BRAND_NAME}` }

export default function About() {
  return (
    <main className="flow">
      <h1 className="display" style={{ fontSize: '2rem' }}>
        About
      </h1>
      <p>
        {BRAND_NAME} shows every game from your chess.com history, and runs a full engine
        breakdown on any one of them. It can also judge your whole history at once and hand you
        a Wrapped-style story. It is free and open source.
      </p>
      <p>
        Results are public, reachable only by their unguessable link. The games themselves are
        already public through chess.com.
      </p>
      <p className="quiet">
        Analysis by <a href="https://stockfishchess.org">Stockfish</a>, the open-source chess
        engine, running as a separate GPLv3 program. Openings from the lichess
        chess-openings dataset (CC0).
      </p>
      <p>
        <Link href="/">Back</Link>
      </p>
    </main>
  )
}
