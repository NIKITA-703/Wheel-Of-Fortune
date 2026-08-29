import { useEffect, useMemo, useRef, useState } from 'react'
import {
  cameraEntropyProvider,
  geolocationEntropyProvider,
  microphoneEntropyProvider,
  randomIntInclusive,
  secureRandomIndex,
  secureShuffleWithEntropy,
  startInteractionEntropyCapture,
  type EntropyProvider,
  type EntropyReport,
  type SelectionMath,
} from '../randomEngine'
import { Wheel, WHEEL_EXIT_DURATION } from './Wheel'

type Mode = 'single' | 'elimination'
type HistoryItem = { name: string; removed: boolean; time: string }

const WHEEL_EXIT_COMMIT_DELAY = 80

const normalizeSignedAngle = (angle: number) => ((angle + 180) % 360 + 360) % 360 - 180

const removalRotationCompensation = (items: string[], removedItem: string) => {
  const total = items.length
  const removedIndex = items.indexOf(removedItem)
  if (total <= 1 || removedIndex < 0) return 0

  const remainingItems = items.filter((item) => item !== removedItem)
  if (!remainingItems.length) return 0

  // Wheel.tsx closes the gap symmetrically around the centre line of the
  // removed sector. That temporary layout has a different angular origin
  // from the normal boundsAt(...), which always starts at -90deg.
  // When the exiting item is finally removed from React state, compensate
  // that origin difference with the wheel rotation so the picture on screen
  // remains pixel-stable instead of snapping to the canonical -90deg layout.
  const oldSlice = 360 / total
  const newSlice = 360 / remainingItems.length
  const removedCenter = -90 + (removedIndex + 0.5) * oldSlice

  const nextOriginalIndex = (removedIndex + 1) % total
  const nextItem = items[nextOriginalIndex]
  const nextTargetIndex = remainingItems.indexOf(nextItem)
  const temporaryLayoutStart = removedCenter - nextTargetIndex * newSlice

  return normalizeSignedAngle(temporaryLayoutStart - (-90))
}

const DEFAULT_OPTIONS = `Пицца
Суши
Бургеры
Паста
Тако
Стейк
Салат
Рамен`

const parseOptions = (text: string) => {
  const seen = new Set<string>()
  return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => {
    const key = line.toLocaleLowerCase('ru')
    if (!line || seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 100)
}

const loadText = () => {
  try { return localStorage.getItem('fair-wheel.options') || DEFAULT_OPTIONS } catch { return DEFAULT_OPTIONS }
}

const loadMode = (): Mode => {
  try { return localStorage.getItem('fair-wheel.mode') === 'single' ? 'single' : 'elimination' } catch { return 'elimination' }
}

const Icon = ({ children }: { children: React.ReactNode }) => <span className="icon" aria-hidden="true">{children}</span>

export function App() {
  const [text, setText] = useState(loadText)
  const [mode, setMode] = useState<Mode>(loadMode)
  const [eliminated, setEliminated] = useState<Set<string>>(() => new Set())
  const [winner, setWinner] = useState<string | null>(null)
  const [pendingWinner, setPendingWinner] = useState<string | null>(null)
  const [exitingItem, setExitingItem] = useState<string | null>(null)
  const [enteringItem, setEnteringItem] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [rotation, setRotation] = useState(0)
  const [pointerAngle, setPointerAngle] = useState(0)
  const [wheelItems, setWheelItems] = useState<string[]>(() => parseOptions(loadText()))
  const [spinDuration, setSpinDuration] = useState(7_500)
  const [spinning, setSpinning] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<EntropyReport | null>(null)
  const [showAudit, setShowAudit] = useState(false)
  const [networkEnabled, setNetworkEnabled] = useState(true)
  const [sensorPanel, setSensorPanel] = useState(false)
  const [gps, setGps] = useState(false)
  const [microphone, setMicrophone] = useState(false)
  const [camera, setCamera] = useState(false)
  const [editing, setEditing] = useState(false)
  const [panelWidth, setPanelWidth] = useState(460)
  const [resizingPanel, setResizingPanel] = useState(false)
  const [lastMath, setLastMath] = useState<SelectionMath | null>(null)
  const spinGuard = useRef(false)
  const wheelRemovalTimer = useRef<number | null>(null)

  const options = useMemo(() => parseOptions(text), [text])
  const activeOptions = useMemo(() => options.filter((item) => !eliminated.has(item)), [options, eliminated])
  const wheelTransitioning = exitingItem !== null || enteringItem !== null

  const cancelWheelRemoval = () => {
    if (wheelRemovalTimer.current !== null) window.clearTimeout(wheelRemovalTimer.current)
    wheelRemovalTimer.current = null
    setExitingItem(null)
    setEnteringItem(null)
  }

  useEffect(() => {
    const stopCapture = startInteractionEntropyCapture()
    return stopCapture
  }, [])

  useEffect(() => {
    try { localStorage.setItem('fair-wheel.options', text) } catch { /* private mode */ }
  }, [text])

  useEffect(() => {
    try { localStorage.setItem('fair-wheel.mode', mode) } catch { /* private mode */ }
  }, [mode])

  useEffect(() => {
    if (!resizingPanel) return
    const resize = (event: PointerEvent) => {
      const maximum = Math.min(700, window.innerWidth * 0.5)
      setPanelWidth(Math.round(Math.max(390, Math.min(maximum, window.innerWidth - event.clientX))))
    }
    const stop = () => setResizingPanel(false)
    window.addEventListener('pointermove', resize)
    window.addEventListener('pointerup', stop, { once: true })
    return () => {
      window.removeEventListener('pointermove', resize)
      window.removeEventListener('pointerup', stop)
    }
  }, [resizingPanel])

  const spin = async () => {
    if (spinGuard.current || spinning || waiting || wheelTransitioning || !activeOptions.length) return
    cancelWheelRemoval()
    if (activeOptions.length === 1) {
      setWheelItems(activeOptions)
      setWinner(activeOptions[0])
      return
    }
    spinGuard.current = true
    setError(null)
    setWinner(null)
    setWaiting(true)
    try {
      const extraEntropyProviders: EntropyProvider[] = []
      if (gps) extraEntropyProviders.push(geolocationEntropyProvider)
      if (microphone) extraEntropyProviders.push(microphoneEntropyProvider)
      if (camera) extraEntropyProviders.push(cameraEntropyProvider)
      const result = await secureRandomIndex(activeOptions, {
        includeNetwork: networkEnabled,
        timeoutMs: extraEntropyProviders.length ? 12_000 : 2_500,
        extraEntropyProviders,
      })
      const slice = 360 / activeOptions.length
      // The audited draw fixes the selected sector. The user-set pointer angle
      // only changes where it stops; it never changes which item was selected.
      const landingOffset = (randomIntInclusive(-3_200, 3_200) / 10_000) * slice
      const target = pointerAngle - (result.index + 0.5) * slice + landingOffset
      const duration = activeOptions.length === 2
        ? randomIntInclusive(15_000, 20_000)
        : randomIntInclusive(7_500, 13_500)
      const inertiaTurns = Math.max(6, Math.round(duration / 1_150)) + randomIntInclusive(0, 2)
      const turns = Math.ceil((rotation - target) / 360) + inertiaTurns
      setReport(result.report)
      setLastMath(result.math)
      setPendingWinner(result.item)
      setWheelItems(activeOptions)
      setSpinDuration(duration)
      setWaiting(false)
      setSpinning(true)
      setRotation(target + turns * 360)
    } catch (reason) {
      setWaiting(false)
      spinGuard.current = false
      setError(reason instanceof Error ? reason.message : 'Не удалось запустить колесо')
    }
  }

  const finishSpin = () => {
    if (!spinning || !pendingWinner) return
    const selected = pendingWinner
    const removed = mode === 'elimination' && activeOptions.length > 1
    setSpinning(false)
    setPendingWinner(null)
    setWinner(selected)
    setHistory((items) => [{ name: selected, removed, time: new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) }, ...items].slice(0, 20))
    if (removed) {
      setEliminated((items) => new Set(items).add(selected))
      // Preserve the exact visual orientation reached by Wheel.tsx at the end
      // of its symmetric gap-closing animation. Without this compensation,
      // dropping exitingItem makes boundsAt(...) jump back to its -90deg seam.
      const rotationCompensation = removalRotationCompensation(wheelItems, selected)
      cancelWheelRemoval()
      setExitingItem(selected)
      wheelRemovalTimer.current = window.setTimeout(() => {
        setRotation((current) => current + rotationCompensation)
        setWheelItems((items) => items.filter((item) => item !== selected))
        setExitingItem(null)
        wheelRemovalTimer.current = null
      }, WHEEL_EXIT_DURATION + WHEEL_EXIT_COMMIT_DELAY)
    }
    spinGuard.current = false
  }

  // Transition events can be suppressed by a browser/tab switch; never leave UI locked.
  useEffect(() => {
    if (!spinning) return
    const timer = window.setTimeout(finishSpin, spinDuration + 1_500)
    return () => window.clearTimeout(timer)
  }, [spinning, pendingWinner, spinDuration])

  const updateText = (value: string) => {
    cancelWheelRemoval()
    setText(value)
    setWheelItems(parseOptions(value))
    setEliminated(new Set())
    setWinner(null)
    setHistory([])
  }

  const reset = () => {
    cancelWheelRemoval()
    setEliminated(new Set())
    setWinner(null)
    setPendingWinner(null)
    setHistory([])
    setError(null)
    setWheelItems(options)
  }

  const shuffle = async () => {
    if (spinning || waiting || wheelTransitioning) return
    cancelWheelRemoval()
    setWaiting(true)
    setError(null)
    try {
      const result = await secureShuffleWithEntropy(options, {
        includeNetwork: networkEnabled,
        timeoutMs: 2_500,
      })
      setText(result.items.join('\n'))
      setWheelItems(result.items.filter((item) => !eliminated.has(item)))
      setWinner(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось перетасовать список')
    } finally {
      setWaiting(false)
    }
  }

  const excludeOption = (item: string) => {
    if (eliminated.has(item) || activeOptions.length <= 1 || spinning || waiting || wheelTransitioning) return
    cancelWheelRemoval()
    const next = new Set(eliminated).add(item)
    const rotationCompensation = removalRotationCompensation(wheelItems, item)
    setEliminated(next)
    setExitingItem(item)
    wheelRemovalTimer.current = window.setTimeout(() => {
      setRotation((current) => current + rotationCompensation)
      setWheelItems(options.filter((option) => !next.has(option)))
      setExitingItem(null)
      wheelRemovalTimer.current = null
    }, WHEEL_EXIT_DURATION + WHEEL_EXIT_COMMIT_DELAY)
  }

  const restoreOption = (item: string) => {
    if (!eliminated.has(item) || spinning || waiting || wheelTransitioning) return
    cancelWheelRemoval()
    const next = new Set(eliminated)
    next.delete(item)
    setEliminated(next)
    setWheelItems(options.filter((option) => !next.has(option)))
    setEnteringItem(item)
    wheelRemovalTimer.current = window.setTimeout(() => {
      setEnteringItem(null)
      wheelRemovalTimer.current = null
    }, 1_100)
  }

  const crossOutWinner = () => {
    if (!winner) return
    excludeOption(winner)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.code === 'Escape' && showAudit) {
        event.preventDefault()
        setShowAudit(false)
        return
      }
      if (showAudit) return
      if (event.code === 'Space' && target?.tagName !== 'TEXTAREA' && target?.tagName !== 'INPUT') {
        event.preventDefault()
        void spin()
      }
      if (event.code === 'KeyS' && target?.tagName !== 'TEXTAREA' && target?.tagName !== 'INPUT') {
        event.preventDefault()
        crossOutWinner()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const fullscreen = async () => {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen().catch(() => undefined)
    else await document.exitFullscreen().catch(() => undefined)
  }

  return (
    <div className={`app ${resizingPanel ? 'is-resizing' : ''}`} style={{ '--panel-width': `${panelWidth}px` } as React.CSSProperties}>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Честное колесо">
          <span className="brand-mark">✦</span>
          <span>Честное колесо</span>
        </a>
        <div className="top-actions">
          <button className="icon-button audit-trigger" type="button" onClick={() => setShowAudit(true)} title="Проверка честности" aria-label="Открыть аудит честности">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.8 2.5 5.7 13h5.7l-1.2 8.5L18.4 10h-5.6l1-7.5Z" /></svg>
          </button>
          <button className="icon-button" type="button" onClick={fullscreen} title="Во весь экран">⛶</button>
        </div>
      </header>

      <main id="top" className="layout">
        <section className="hero-panel">
          <div className="hero-copy">
            <div className="eyebrow"><span className="live-dot" /> Криптографически честный выбор</div>
            <h1>Крути. Выбирай.<br /><span>Без подкупа.</span></h1>
            <p className="lead">Каждый результат рождается из Web Crypto и двух независимых снимков доступной энтропии.</p>
            <div className="result-space" aria-live="polite">
              {winner ? (
                <div className={`winner-card ${eliminated.has(winner) ? 'is-eliminated' : 'is-survivor'}`}>
                  <div><span>{eliminated.has(winner) ? (mode === 'elimination' ? 'Выбывает' : 'Зачёркнут') : 'Победитель'}</span><strong>{winner}</strong></div>
                  {!eliminated.has(winner) && <button type="button" onClick={crossOutWinner}><kbd>S</kbd> Зачеркнуть</button>}
                </div>
              ) : <div className="result-placeholder"><span>Результат появится здесь</span><strong>Колесо ещё не вращалось</strong></div>}
              {error && <div className="error-card">{error}</div>}
            </div>
          </div>

          <div className="wheel-area">
            <Wheel
              items={wheelItems}
              rotation={rotation}
              duration={spinDuration}
              spinning={spinning}
              selectedIndex={winner ? wheelItems.indexOf(winner) : null}
              exitingItem={exitingItem}
              enteringItem={enteringItem}
              transitioning={wheelTransitioning}
              pointerAngle={pointerAngle}
              onPointerAngleChange={setPointerAngle}
              waiting={waiting}
              onSpin={() => void spin()}
              onFinished={finishSpin}
            />
            <div className="wheel-status" aria-live="polite">
              {waiting && <><span className="status-spinner" /> Собираем энтропию…</>}
              {spinning && <>Колесо решает…</>}
              {!waiting && !spinning && activeOptions.length > 1 && <>Перетащите стрелку · нажмите кнопку или <kbd>Space</kbd></>}
              {!waiting && !spinning && activeOptions.length === 1 && <>Последний вариант определён</>}
            </div>
          </div>
        </section>

        <aside className="control-panel">
          <div
            className="resize-handle"
            role="separator"
            aria-label="Изменить ширину панели"
            aria-orientation="vertical"
            tabIndex={0}
            onPointerDown={(event) => { event.preventDefault(); setResizingPanel(true) }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') setPanelWidth((width) => Math.min(700, width + 20))
              if (event.key === 'ArrowRight') setPanelWidth((width) => Math.max(390, width - 20))
            }}
          ><span /></div>
          <div className="panel-heading">
            <div><span className="panel-kicker">Настройка</span><h2>Варианты</h2></div>
            <div className="panel-heading-actions">
              <button className={`edit-button ${editing ? 'is-done' : ''}`} type="button" onClick={() => setEditing((value) => !value)}>
                <span>{editing ? '✓' : '✎'}</span>{editing ? 'Готово' : 'Изменить'}
              </button>
              <span className="count-badge">{activeOptions.length} / {options.length}</span>
            </div>
          </div>

          <div className={`mode-switch is-${mode}`} role="group" aria-label="Режим колеса">
            <button className={mode === 'elimination' ? 'active' : ''} type="button" disabled={spinning || waiting || wheelTransitioning} onClick={() => { setMode('elimination'); reset() }}>На выбывание</button>
            <button className={mode === 'single' ? 'active' : ''} type="button" disabled={spinning || waiting || wheelTransitioning} onClick={() => { setMode('single'); reset() }}>Один выбор</button>
          </div>

          {editing ? <>
            <label className="input-label" htmlFor="options">По одному варианту на строку</label>
            <textarea id="options" value={text} onChange={(event) => updateText(event.target.value)} disabled={spinning || waiting || wheelTransitioning} spellCheck="false" autoFocus />
            <div className="text-meta"><span>Пустые строки и дубли пропускаются</span><span>до 100</span></div>
          </> : <>
            <div className="input-label">Текущий список</div>
            <div className="options-display">
              {options.map((item, index) => {
                const isEliminated = eliminated.has(item)
                return <div key={item} className={isEliminated ? 'eliminated' : ''}>
                  <span className="option-number">{String(index + 1).padStart(2, '0')}</span>
                  <span className="option-name">{item}</span>
                  {isEliminated ? (
                    <button className="restore-option" type="button" title="Вернуть вариант" aria-label={`Вернуть ${item}`} disabled={spinning || waiting || wheelTransitioning} onClick={() => restoreOption(item)}>↩</button>
                  ) : (
                    <button className="exclude-option" type="button" title="Зачеркнуть вариант" aria-label={`Зачеркнуть ${item}`} disabled={activeOptions.length <= 1 || spinning || waiting || wheelTransitioning} onClick={() => excludeOption(item)}>╱</button>
                  )}
                </div>
              })}
            </div>
            <div className="text-meta"><span>Выпавшие варианты зачёркиваются</span><span>до 100</span></div>
          </>}

          <div className="action-grid">
            <button className="secondary-button" type="button" onClick={() => void shuffle()} disabled={options.length < 2 || spinning || waiting || wheelTransitioning}><Icon>↝</Icon> Перетасовать</button>
            <button className="secondary-button" type="button" onClick={reset} disabled={spinning || waiting || wheelTransitioning}><Icon>↺</Icon> Вернуть все</button>
          </div>

          <div className="source-setting">
            <div><strong>Внешняя энтропия</strong><span>Погода, рынки, блоки и датчики сети</span></div>
            <label className="switch"><input type="checkbox" checked={networkEnabled} onChange={(event) => setNetworkEnabled(event.target.checked)} /><span /></label>
          </div>

          <button className="sensor-toggle" type="button" onClick={() => setSensorPanel((value) => !value)}>
            Дополнительные датчики <span>{sensorPanel ? '−' : '+'}</span>
          </button>
          {sensorPanel && <div className="sensor-options">
            <label><input type="checkbox" checked={gps} onChange={(event) => setGps(event.target.checked)} /> GPS</label>
            <label><input type="checkbox" checked={microphone} onChange={(event) => setMicrophone(event.target.checked)} /> Микрофон</label>
            <label><input type="checkbox" checked={camera} onChange={(event) => setCamera(event.target.checked)} /> Камера</label>
            <p>Браузер запросит разрешение. Данные не сохраняются и не отправляются нами.</p>
          </div>}

          {history.length > 0 && <div className="history-list">
            <div className="section-title"><span>История</span><small>{history.length}</small></div>
            {history.slice(0, 8).map((item, index) => <div key={`${item.name}-${item.time}-${index}`}><span className="history-number">{history.length - index}</span><strong>{item.name}</strong><time>{item.time}</time></div>)}
          </div>}
        </aside>
      </main>

      <footer><span>Web Crypto</span><span>SHA-256</span><span>Без modulo bias</span><button type="button" onClick={() => setShowAudit(true)}>Как проверяется честность?</button></footer>

      {showAudit && <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowAudit(false)}>
        <section className="audit-modal" role="dialog" aria-modal="true" aria-label="Аудит случайности" onMouseDown={(event) => event.stopPropagation()}>
          <button className="modal-close" type="button" onClick={() => setShowAudit(false)} title="Закрыть (Esc)">×<small>Esc</small></button>
          <span className="panel-kicker">Аудит</span><h2>След случайности</h2>
          {!report ? <p className="empty-audit">После первого вращения здесь появится отчёт об источниках.</p> : <>
            <div className="audit-stats"><div><strong>{report.liveSources}</strong><span>собрано</span></div><div><strong>{report.unavailableSources}</strong><span>недоступно</span></div></div>
            <div className="math-card">
              <span>Почему выпал именно этот вариант</span>
              {lastMath ? <>
                <strong>В колесе {lastMath.range} {lastMath.range === 1 ? 'вариант' : lastMath.range < 5 ? 'варианта' : 'вариантов'} — шанс каждого ровно {(100 / lastMath.range).toFixed(2)}%</strong>
                <div className="math-steps">
                  <div><i>1</i><span><small>Браузер бросает цифровой жребий</small><b>Получено число <em>{lastMath.candidate.toLocaleString('ru')}</em></b><p>Оно создаётся Web Crypto и смешивается с двумя снимками внешних данных. Погода или курс валют не могут сами назначить победителя.</p></span></div>
                  <div><i>2</i><span><small>Число превращается в позицию</small><b><em>{lastMath.candidate.toLocaleString('ru')}</em> ÷ {lastMath.range} = {Math.floor(lastMath.candidate / lastMath.range).toLocaleString('ru')}, остаток <em>{lastMath.offset}</em></b><p>Возможны только остатки от 0 до {lastMath.range - 1} — по одному для каждого варианта.</p></span></div>
                  <div><i>3</i><span><small>Остаток указывает строку</small><b>Остаток {lastMath.offset} означает сектор №{lastMath.offset + 1}</b><p>В списке под этим номером находится «{winner ?? pendingWinner ?? 'ожидаем остановку колеса'}».</p></span></div>
                </div>
                <div className="math-result"><span>Итоговый выбор</span><strong>№{lastMath.offset + 1} · {winner ?? pendingWinner ?? 'ожидаем остановку колеса'}</strong></div>
                <p className="fairness-note"><strong>Почему шанс действительно одинаковый?</strong> Если цифровое число попадает в маленький «лишний хвост», движок выбрасывает его и берёт новое. Так ни одна строка не получает даже микроскопического преимущества. В этом вращении повторов: {lastMath.rejectedDraws}.</p>
                <details className="technical-math">
                  <summary>Показать технические числа</summary>
                  <div><span>Полученное UInt32</span><code>{lastMath.candidate.toLocaleString('ru')}</code></div>
                  <div><span>Принимаем значения меньше</span><code>{lastMath.acceptanceLimit.toLocaleString('ru')}</code></div>
                  <div><span>Фактическое деление</span><code>{lastMath.candidate.toLocaleString('ru')} mod {lastMath.range} = {lastMath.offset}</code></div>
                  <div><span>Положение стрелки</span><code>{pointerAngle.toFixed(2)}° из 360°</code></div>
                  <div><span>Исключено значений из хвоста</span><code>{lastMath.rejectedValues}</code></div>
                </details>
              </> : <strong>Появится после вращения</strong>}
            </div>
            <label>SHA-256 отпечаток</label><code>{report.digestHex}</code>
            <div className="source-list">{report.samples.map((sample, index) => <div key={`${sample.pass}-${sample.source}-${index}`}><i className={sample.status} /><span><strong>{sample.label}</strong><small>{sample.source} · проход {sample.pass}</small></span></div>)}</div>
          </>}
        </section>
      </div>}
    </div>
  )
}
