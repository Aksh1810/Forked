import Link from 'next/link'
import { BRAND_NAME } from '@forked/shared'
import { copy } from '../../copy'
import { LetterGlitch } from '../../components/bits/LetterGlitch'
import { GlitchText } from '../../components/bits/GlitchText'

export const metadata = { title: `about | ${BRAND_NAME}` }

// C5: no FadeContent here — a static about page has no scroll-triggered
// reveal worth the flash-of-dim-text on load.
export default function About() {
  return (
    <main className="flow">
      <LetterGlitch />
      <h1 className="display" style={{ fontSize: '2rem' }}>
        <GlitchText text="About" />
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
      <p className="quiet">
        {copy.about.engineCredit}{' '}
        <a href="https://github.com/nmrugg/stockfish.js" target="_blank" rel="noopener noreferrer">
          {copy.about.engineSource}
        </a>{' '}
        ·{' '}
        <a href="/engine/Copying.txt" target="_blank" rel="noopener noreferrer">
          {copy.about.engineLicense}
        </a>
      </p>
      <p>
        <Link href="/">Back</Link>
      </p>
      <p className="display brand-endcap" aria-hidden>
        forked<span className="qq">??</span>
      </p>
    </main>
  )
}
