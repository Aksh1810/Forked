import { BRAND_NAME } from '@blunderfarm/shared'

export default function Home() {
  return (
    <main style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
      <h1>{BRAND_NAME}</h1>
    </main>
  )
}
