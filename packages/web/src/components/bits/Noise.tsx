'use client'

import { useEffect, useState } from 'react'

// Static film grain: one 128px noise tile generated once and repeated as a
// fixed background layer. Zero runtime cost after mount. Reduced motion keeps
// it (it does not move), but it renders nothing until the tile exists so SSR
// output is stable.
export function Noise({ alpha = 0.08 }: { alpha?: number }) {
  const [tile, setTile] = useState<string | null>(null)

  useEffect(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const ctx = c.getContext('2d')
    if (!ctx) return
    const img = ctx.createImageData(128, 128)
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.floor(Math.random() * 256)
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v
      img.data[i + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    setTile(c.toDataURL())
  }, [])

  if (!tile) return null
  return (
    <div
      className="bits-bg-layer"
      style={{ backgroundImage: `url(${tile})`, backgroundRepeat: 'repeat', opacity: alpha }}
      aria-hidden
    />
  )
}
