import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'

type WheelProps = {
  items: string[]
  rotation: number
  duration: number
  spinning: boolean
  selectedIndex: number | null
  exitingItem: string | null
  enteringItem: string | null
  transitioning: boolean
  pointerAngle: number
  onPointerAngleChange: (angle: number) => void
  waiting: boolean
  onSpin: () => void
  onFinished: () => void
}

const COLORS = [
  { from: '#ff667d', to: '#d83b57', glow: 'rgba(255,82,116,.55)' },
  { from: '#ffd064', to: '#dc9134', glow: 'rgba(255,194,74,.5)' },
  { from: '#43dda2', to: '#199a69', glow: 'rgba(54,222,158,.5)' },
  { from: '#55bcff', to: '#2878ca', glow: 'rgba(65,168,255,.52)' },
  { from: '#aa7cff', to: '#7044c9', glow: 'rgba(153,103,255,.52)' },
  { from: '#f36abb', to: '#be3983', glow: 'rgba(239,82,176,.5)' },
  { from: '#35d2dc', to: '#138994', glow: 'rgba(39,207,220,.5)' },
  { from: '#ff9454', to: '#d75a30', glow: 'rgba(255,126,68,.5)' },
]
const CENTER = 250
const RADIUS = 230

type SectorBounds = { start: number; end: number }

const boundsAt = (index: number, total: number): SectorBounds => {
  const size = 360 / Math.max(1, total)
  return { start: -90 + index * size, end: -90 + (index + 1) * size - (total === 1 ? 0.001 : 0) }
}

const mix = (from: number, to: number, progress: number) => from + (to - from) * progress

const mixBounds = (from: SectorBounds, to: SectorBounds, progress: number): SectorBounds => ({
  start: mix(from.start, to.start, progress),
  end: mix(from.end, to.end, progress),
})

const polar = (radius: number, angle: number) => {
  const radians = (angle * Math.PI) / 180
  return { x: CENTER + radius * Math.cos(radians), y: CENTER + radius * Math.sin(radians) }
}

const sectorPath = (start: number, end: number) => {
  if (end - start >= 359.998) {
    const first = polar(RADIUS, start)
    const opposite = polar(RADIUS, start + 180)
    return `M ${first.x} ${first.y} A ${RADIUS} ${RADIUS} 0 1 1 ${opposite.x} ${opposite.y} A ${RADIUS} ${RADIUS} 0 1 1 ${first.x} ${first.y} Z`
  }
  const first = polar(RADIUS, start)
  const last = polar(RADIUS, end)
  const largeArc = end - start > 180 ? 1 : 0
  return `M ${CENTER} ${CENTER} L ${first.x} ${first.y} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${last.x} ${last.y} Z`
}

const shortLabel = (label: string, total: number) => {
  const limit = total > 20 ? 9 : total > 12 ? 13 : 18
  return label.length > limit ? `${label.slice(0, limit - 1)}…` : label
}

export function Wheel({ items, rotation, duration, spinning, selectedIndex, exitingItem, enteringItem, transitioning, pointerAngle, onPointerAngleChange, waiting, onSpin, onFinished }: WheelProps) {
  const filterId = useId().replaceAll(':', '')
  const shellRef = useRef<HTMLDivElement>(null)
  const wheelRef = useRef<HTMLDivElement>(null)
  const previousRotation = useRef(rotation)
  const finishCallback = useRef(onFinished)
  const colorByItem = useRef(new Map<string, number>())
  const [draggingPointer, setDraggingPointer] = useState(false)
  const [layoutProgress, setLayoutProgress] = useState(1)
  const slice = items.length ? 360 / items.length : 360

  items.forEach((item, index) => {
    if (!colorByItem.current.has(item)) colorByItem.current.set(item, index % COLORS.length)
  })

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
      duration: reducedMotion ? 1_200 : duration,
      easing: 'cubic-bezier(.18, 0, .22, 1)',
      fill: 'forwards',
    })

    animation.onfinish = () => {
      previousRotation.current = rotation
      element.style.transform = `rotate(${rotation}deg)`
      finishCallback.current()
    }
    return () => animation.cancel()
  }, [rotation, duration, spinning, items.length])

  useLayoutEffect(() => {
    if (!exitingItem && !enteringItem) {
      setLayoutProgress(1)
      return
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setLayoutProgress(1)
      return
    }

    let frame = 0
    let startedAt = 0
    const animationDuration = exitingItem ? 1_050 : 950
    setLayoutProgress(0)

    const animateLayout = (now: number) => {
      if (!startedAt) startedAt = now
      const progress = Math.min(1, (now - startedAt) / animationDuration)
      setLayoutProgress(progress)
      if (progress < 1) frame = requestAnimationFrame(animateLayout)
    }

    frame = requestAnimationFrame(animateLayout)
    return () => cancelAnimationFrame(frame)
  }, [exitingItem, enteringItem])

  const easedLayoutProgress = layoutProgress * layoutProgress * (3 - 2 * layoutProgress)
  const remainingItems = exitingItem ? items.filter((item) => item !== exitingItem) : items
  const previousItems = enteringItem ? items.filter((item) => item !== enteringItem) : items
  const renderedItems = exitingItem
    ? [exitingItem, ...remainingItems]
    : enteringItem
      ? [...previousItems, enteringItem]
      : items

  const animatedBoundsFor = (item: string, index: number): SectorBounds => {
    const current = boundsAt(index, items.length)

    if (exitingItem) {
      if (item === exitingItem) {
        const center = (current.start + current.end) / 2
        const rawClosure = boundsAt(index % remainingItems.length, remainingItems.length).start
        const closure = rawClosure + Math.round((center - rawClosure) / 360) * 360
        const closingProgress = Math.min(1, easedLayoutProgress / .28)
        return mixBounds(current, { start: closure - 1.525, end: closure + 1.525 }, closingProgress)
      }
      const targetIndex = remainingItems.indexOf(item)
      const reflowProgress = Math.max(0, Math.min(1, (easedLayoutProgress - .08) / .8))
      return mixBounds(current, boundsAt(targetIndex, remainingItems.length), reflowProgress)
    }

    if (enteringItem) {
      if (item === enteringItem) {
        const center = (current.start + current.end) / 2
        const openingProgress = Math.max(0, Math.min(1, (easedLayoutProgress - .28) / .72))
        return mixBounds({ start: center, end: center + .001 }, current, openingProgress)
      }
      const previousIndex = previousItems.indexOf(item)
      return mixBounds(boundsAt(previousIndex, previousItems.length), current, easedLayoutProgress)
    }

    return current
  }

  const movePointer = (clientX: number, clientY: number) => {
    const shell = shellRef.current
    if (!shell) return
    const bounds = shell.getBoundingClientRect()
    const x = clientX - (bounds.left + bounds.width / 2)
    const y = clientY - (bounds.top + bounds.height / 2)
    const angle = (Math.atan2(y, x) * 180 / Math.PI + 90 + 360) % 360
    onPointerAngleChange(Math.round(angle * 100) / 100)
  }

  const startPointerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (spinning || waiting || transitioning) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDraggingPointer(true)
    movePointer(event.clientX, event.clientY)
  }

  const continuePointerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingPointer) return
    movePointer(event.clientX, event.clientY)
  }

  const finishPointerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingPointer) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setDraggingPointer(false)
  }

  return (
    <div ref={shellRef} className={`wheel-shell ${spinning ? 'is-active' : ''} ${transitioning ? 'is-transitioning' : ''}`}>
      <div
        className={`pointer-orbit ${draggingPointer ? 'is-dragging' : ''}`}
        style={{ '--pointer-angle': `${pointerAngle}deg` } as CSSProperties}
      >
        <div
          className="pointer"
          role="slider"
          tabIndex={spinning || waiting || transitioning ? -1 : 0}
          aria-label="Положение стрелки"
          aria-valuemin={0}
          aria-valuemax={360}
          aria-valuenow={Math.round(pointerAngle)}
          aria-disabled={spinning || waiting || transitioning}
          onPointerDown={startPointerDrag}
          onPointerMove={continuePointerDrag}
          onPointerUp={finishPointerDrag}
          onPointerCancel={finishPointerDrag}
          onKeyDown={(event) => {
            if (spinning || waiting || transitioning || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
            event.preventDefault()
            const direction = event.key === 'ArrowRight' ? 1 : -1
            const step = event.shiftKey ? 10 : 2
            onPointerAngleChange((pointerAngle + direction * step + 360) % 360)
          }}
        ><span /></div>
      </div>
      <div
        ref={wheelRef}
        className={`wheel ${spinning ? 'is-spinning' : ''}`}
        style={{ transform: `rotate(${rotation}deg)` }}
      >
        <svg viewBox="0 0 500 500" role="img" aria-label={`Колесо из ${items.length} вариантов`}>
          <defs>
            <linearGradient id={`${filterId}-rim`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#58f3ba" />
              <stop offset="0.48" stopColor="#5e8cff" />
              <stop offset="1" stopColor="#d96dff" />
            </linearGradient>
            <radialGradient id={`${filterId}-depth`} cx="48%" cy="43%" r="59%">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.075" />
              <stop offset="0.58" stopColor="#ffffff" stopOpacity="0.015" />
              <stop offset="0.82" stopColor="#05070b" stopOpacity="0.06" />
              <stop offset="1" stopColor="#030408" stopOpacity="0.18" />
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
          <g>
            <circle cx={CENTER} cy={CENTER} r="241" className="wheel-outer-shadow" />
            <circle cx={CENTER} cy={CENTER} r="237" fill={`url(#${filterId}-rim)`} className="wheel-rim" />
            <circle cx={CENTER} cy={CENTER} r="232" className="wheel-rim-inner" />
            {items.length === 1 && !enteringItem && !exitingItem ? (
              <circle cx={CENTER} cy={CENTER} r={RADIUS} fill={`url(#${filterId}-sector-${colorByItem.current.get(items[0]) ?? 0})`} />
            ) : renderedItems.map((item) => {
              const index = items.indexOf(item)
              const { start, end } = animatedBoundsFor(item, index)
              const animatedAngle = (start + end) / 2
              const point = polar(items.length > 18 ? 155 : 150, animatedAngle)
              const normalizedAngle = (animatedAngle % 360 + 360) % 360
              const readableAngle = normalizedAngle > 90 && normalizedAngle < 270 ? animatedAngle + 180 : animatedAngle
              let motionAngle = animatedAngle
              if (item === exitingItem && remainingItems.length) {
                const current = boundsAt(index, items.length)
                const center = (current.start + current.end) / 2
                const rawClosure = boundsAt(index % remainingItems.length, remainingItems.length).start
                motionAngle = rawClosure + Math.round((center - rawClosure) / 360) * 360
              }
              const radians = (motionAngle * Math.PI) / 180
              const colorIndex = colorByItem.current.get(item) ?? index % COLORS.length
              const color = COLORS[colorIndex]
              const tileStyle = {
                '--lift-x': `${Math.cos(radians) * 7}px`,
                '--lift-y': `${Math.sin(radians) * 7}px`,
                '--pop-x': `${Math.cos(radians) * 13}px`,
                '--pop-y': `${Math.sin(radians) * 13}px`,
                '--fly-x': `${Math.cos(radians) * 175}px`,
                '--fly-y': `${Math.sin(radians) * 175}px`,
                '--exit-x': `${Math.cos(radians) * 105}px`,
                '--exit-y': `${Math.sin(radians) * 105}px`,
                '--exit-far-x': `${Math.cos(radians) * 205}px`,
                '--exit-far-y': `${Math.sin(radians) * 205}px`,
                '--sector-glow': color.glow,
              } as CSSProperties
              const path = sectorPath(start, end)
              return (
                <g
                  key={`${item}-${index}`}
                  className={`wheel-sector-tile ${!spinning && selectedIndex === index ? 'is-selected' : ''} ${item === exitingItem ? 'is-exiting' : ''} ${item === enteringItem ? 'is-entering' : ''}`}
                  style={tileStyle}
                >
                  <path d={path} fill={`url(#${filterId}-sector-${colorIndex})`} className="wheel-sector" />
                  <path d={path} className="wheel-sector-line" />
                  <text
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
                </g>
              )
            })}
            <circle cx={CENTER} cy={CENTER} r={RADIUS - 2} fill={`url(#${filterId}-inner-light)`} className="wheel-inner-light" />
            <circle cx={CENTER} cy={CENTER} r={RADIUS - 2} fill={`url(#${filterId}-depth)`} className="wheel-glass" />
            {items.length === 1 && !enteringItem && !exitingItem && items.map((item, index) => {
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
        disabled={spinning || waiting || transitioning || items.length === 0}
        aria-label="Крутить колесо"
      >
        {waiting ? <span className="button-loader" /> : spinning ? '•••' : 'Крутить'}
      </button>
    </div>
  )
}
