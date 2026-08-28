import { useId } from 'react'

type WheelProps = {
  items: string[]
  rotation: number
  spinning: boolean
  waiting: boolean
  onSpin: () => void
  onFinished: () => void
}

const COLORS = [
  { from: '#ff5f78', to: '#e83d62' },
  { from: '#ffcf58', to: '#f29b38' },
  { from: '#39dfa0', to: '#16a878' },
  { from: '#55c7ff', to: '#287de8' },
  { from: '#a47bff', to: '#7046e8' },
  { from: '#ff67ba', to: '#d9368a' },
  { from: '#39dfd2', to: '#149f9b' },
  { from: '#ff9c4a', to: '#ed5f2e' },
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
  const slice = items.length ? 360 / items.length : 360

  return (
    <div className="wheel-shell">
      <div className="pointer" aria-hidden="true"><span /></div>
      <div
        className={`wheel ${spinning ? 'is-spinning' : ''}`}
        style={{ transform: `rotate(${rotation}deg)` }}
        onTransitionEnd={(event) => {
          if (event.propertyName === 'transform') onFinished()
        }}
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
            <circle cx={CENTER} cy={CENTER} r={RADIUS - 2} className="wheel-glass" />
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
