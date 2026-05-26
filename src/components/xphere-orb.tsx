'use client'

import { useEffect } from 'react'
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion'

// factor = max SVG-unit offset when mouse is at viewport edge.
// Movement scales naturally with the rendered size (viewBox 512).
const LAYERS = [
  { fill: '#4F39F6', cx: 256, cy: 256, r: 256,   factor: 0   },
  { fill: '#665AF4', cx: 256, cy: 256, r: 204.8, factor: 28  },
  { fill: '#7074F9', cx: 256, cy: 256, r: 153.6, factor: 60  },
  { fill: '#848BF9', cx: 256, cy: 256, r: 99.84, factor: 100 },
]

interface XphereOrbProps {
  size?: number
  className?: string
}

export function XphereOrb({ size = 300, className }: XphereOrbProps) {
  const rawX = useMotionValue(0)
  const rawY = useMotionValue(0)

  const springX = useSpring(rawX, { stiffness: 90, damping: 22, mass: 0.6 })
  const springY = useSpring(rawY, { stiffness: 90, damping: 22, mass: 0.6 })

  useEffect(() => {
    function onMove(e: MouseEvent) {
      rawX.set((e.clientX / window.innerWidth) * 2 - 1)
      rawY.set((e.clientY / window.innerHeight) * 2 - 1)
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [rawX, rawY])

  return (
    <div className={className} style={{ width: size, height: size }}>
      <svg
        viewBox="0 0 512 512"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
      >
        <defs>
          <clipPath id="xphere-orb-clip">
            <rect width="512" height="512" />
          </clipPath>
        </defs>
        <g clipPath="url(#xphere-orb-clip)">
          {LAYERS.map((layer, i) => (
            <OrbLayer key={i} layer={layer} springX={springX} springY={springY} />
          ))}
        </g>
      </svg>
    </div>
  )
}

type SpringValue = ReturnType<typeof useSpring>

function OrbLayer({
  layer,
  springX,
  springY,
}: {
  layer: (typeof LAYERS)[0]
  springX: SpringValue
  springY: SpringValue
}) {
  const tx = useTransform(springX, (v) => v * layer.factor)
  const ty = useTransform(springY, (v) => v * layer.factor)

  return (
    <motion.g style={{ x: tx, y: ty }}>
      <circle cx={layer.cx} cy={layer.cy} r={layer.r} fill={layer.fill} />
    </motion.g>
  )
}
