import { useId, useLayoutEffect, useRef } from 'react'

type WheelProps = {
  items: string[]
  rotation: number
  spinning: boolean
  waiting: boolean
  onSpin: () => void
  onFinished: () => void
}

const COLORS = [
  { from: '#28766e', to: '#19433f' },
  { from: '#67558c', to: '#3a3054' },
  { from: '#3f7565', to: '#25483d' },
  { from: '#386b92', to: '#23425d' },
  { from: '#664f88', to: '#3d3057' },
  { from: '#87495e', to: '#512b3a' },
  { from: '#327878', to: '#1e4849' },
  { from: '#50688f', to: '#2d3c59' },
]
const CENTER = 250
const RADIUS = 230

const polar = (radius: number, angle: number) => {
  const radians = (angle * Math.PI) / 180
  return { x: CENTER + radius * Math.cos(radians), y: CENTER + radius * Math.sin(radians) }
}

const sectorPath = (start: number, end: number) => {
  const first = polar(RADIUS, start)
  const last = polar(RADIUS, end)
  const largeArc = end - start > 180 ? 1 : 0
  return `M ${CENTER} ${CENTER} L ${first.x} ${first.y} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${last.x} ${last.y} Z`
}

const shortLabel = (label: string, total: number) => {
  const limit = total > 20 ? 9 : total > 12 ? 13 : 18
  return label.length > limit ? `${label.slice(0, limit - 1)}…` : label
}

export function Wheel({ items, rotation, spinning, waiting, onSpin, onFinished }: WheelProps) {
  const filterId = useId().replaceAll(':', '')
  const wheelRef = useRef<HTMLDivElement>(null)
  const previousRotation = useRef(rotation)
  const finishCallback = useRef(onFinished)
  const slice = items.length ? 360 / items.length : 360

  finishCallback.current = onFinished

  useLayoutEffect(() => {
    const element = wheelRef.current
    if (!element) return
    const from = previousRotation.current

    if (!spinning || Math.abs(rotation - from) < 0.001) {
      element.style.transform = `rotate(${rotation}deg)`
      if (!spinning) previousRotation.current = rotation
      return
    }

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const animation = element.animate([
      { transform: `rotate(${from}deg)` },
      { transform: `rotate(${rotation}deg)` },
    ], {
      duration: reducedMotion ? 1_200 : 7_400,
      easing: 'cubic-bezier(.18, 0, .22, 1)',
      fill: 'forwards',
    })

    animation.onfinish = () => {
      previousRotation.current = rotation
      element.style.transform = `rotate(${rotation}deg)`
      finishCallback.current()
    }
    return () => animation.cancel()
  }, [rotation, spinning, items.length])

  return (
    <div className={`wheel-shell ${spinning ? 'is-active' : ''}`}>
      <div className="pointer" aria-hidden="true"><span /></div>
      <div
        ref={wheelRef}
        className={`wheel ${spinning ? 'is-spinning' : ''}`}
        style={{ transform: `rotate(${rotation}deg)` }}
      >
        <svg viewBox="0 0 500 500" role="img" aria-label={`Колесо из ${items.length} вариантов`}>
          <defs>
            <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="7" stdDeviation="8" floodOpacity="0.35" />
            </filter>
            <linearGradient id={`${filterId}-rim`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#58f3ba" />
              <stop offset="0.48" stopColor="#5e8cff" />
              <stop offset="1" stopColor="#d96dff" />
            </linearGradient>
            <radialGradient id={`${filterId}-depth`} cx="48%" cy="43%" r="59%">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.075" />
              <stop offset="0.58" stopColor="#ffffff" stopOpacity="0.015" />
              <stop offset="0.82" stopColor="#05070b" stopOpacity="0.12" />
              <stop offset="1" stopColor="#030408" stopOpacity="0.38" />
            </radialGradient>
            <radialGradient id={`${filterId}-inner-light`} cx="50%" cy="50%" r="50%">
              <stop offset="0" stopColor="#62f5c4" stopOpacity="0.2" />
              <stop offset="0.3" stopColor="#55d9da" stopOpacity="0.07" />
              <stop offset="0.72" stopColor="#4c77ff" stopOpacity="0" />
            </radialGradient>
            {COLORS.map((color, index) => (
              <linearGradient key={`gradient-${index}`} id={`${filterId}-sector-${index}`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor={color.from} />
                <stop offset="1" stopColor={color.to} />
              </linearGradient>
            ))}
          </defs>
          <g filter={`url(#${filterId})`}>
            <circle cx={CENTER} cy={CENTER} r="241" className="wheel-outer-shadow" />
            <circle cx={CENTER} cy={CENTER} r="237" fill={`url(#${filterId}-rim)`} className="wheel-rim" />
            <circle cx={CENTER} cy={CENTER} r="232" className="wheel-rim-inner" />
            {items.length === 1 ? (
              <circle cx={CENTER} cy={CENTER} r={RADIUS} fill={`url(#${filterId}-sector-0)`} />
            ) : items.map((item, index) => {
              const start = -90 + index * slice
              const end = start + slice
              return <path key={`${item}-${index}`} d={sectorPath(start, end)} fill={`url(#${filterId}-sector-${index % COLORS.length})`} className="wheel-sector" />
            })}
            <circle cx={CENTER} cy={CENTER} r={RADIUS - 2} fill={`url(#${filterId}-inner-light)`} className="wheel-inner-light" />
            <circle cx={CENTER} cy={CENTER} r={RADIUS - 2} fill={`url(#${filterId}-depth)`} className="wheel-glass" />
            {items.map((item, index) => {
              const angle = -90 + (index + 0.5) * slice
              const point = polar(items.length > 18 ? 155 : 150, angle)
              const readableAngle = angle > 90 && angle < 270 ? angle + 180 : angle
              return (
                <text
                  key={`label-${item}-${index}`}
                  x={point.x}
                  y={point.y}
                  transform={`rotate(${readableAngle} ${point.x} ${point.y})`}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="wheel-label"
                  style={{ fontSize: items.length > 20 ? 10 : items.length > 12 ? 12 : 14 }}
                >
                  {shortLabel(item, items.length)}
                </text>
              )
            })}
          </g>
          <circle cx={CENTER} cy={CENTER} r="53" className="wheel-hub-glow" />
          <circle cx={CENTER} cy={CENTER} r="49" className="wheel-hub-ring" />
          <circle cx={CENTER} cy={CENTER} r="39" className="wheel-hub" />
        </svg>
      </div>
      <button
        className="spin-button"
        type="button"
        onClick={onSpin}
        disabled={spinning || waiting || items.length === 0}
        aria-label="Крутить колесо"
      >
        {waiting ? <span className="button-loader" /> : spinning ? '•••' : 'Крутить'}
      </button>
    </div>
  )
}
