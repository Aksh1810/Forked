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
        {BRAND_NAME} analyzes your entire chess.com history with a full engine and tells you,
        with numbers, why you lose. It is free and open source.
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
