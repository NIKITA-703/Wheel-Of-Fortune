import { useEffect, useMemo, useRef, useState } from 'react'
import {
  cameraEntropyProvider,
  geolocationEntropyProvider,
  microphoneEntropyProvider,
  secureRandomIndex,
  secureShuffle,
  startInteractionEntropyCapture,
  type EntropyProvider,
  type EntropyReport,
  type SelectionMath,
} from '../randomEngine'
import { Wheel } from './Wheel'

type Mode = 'single' | 'elimination'
type HistoryItem = { name: string; removed: boolean; time: string }

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
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [rotation, setRotation] = useState(0)
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

  const options = useMemo(() => parseOptions(text), [text])
  const activeOptions = useMemo(() => options.filter((item) => !eliminated.has(item)), [options, eliminated])

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
    if (spinGuard.current || spinning || waiting || !activeOptions.length) return
    if (activeOptions.length === 1) {
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
      const target = -(result.index + 0.5) * slice
      const turns = Math.ceil((rotation - target) / 360) + 6
      setReport(result.report)
      setLastMath(result.math)
      setPendingWinner(result.item)
      setWaiting(false)
      setSpinning(true)
      requestAnimationFrame(() => requestAnimationFrame(() => setRotation(target + turns * 360)))
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
    if (removed) setEliminated((items) => new Set(items).add(selected))
    spinGuard.current = false
  }

  // Transition events can be suppressed by a browser/tab switch; never leave UI locked.
  useEffect(() => {
    if (!spinning) return
    const timer = window.setTimeout(finishSpin, 7_000)
    return () => window.clearTimeout(timer)
  }, [spinning, pendingWinner])

  const updateText = (value: string) => {
    setText(value)
    setEliminated(new Set())
    setWinner(null)
    setHistory([])
  }

  const reset = () => {
    setEliminated(new Set())
    setWinner(null)
    setPendingWinner(null)
    setHistory([])
    setError(null)
  }

  const shuffle = () => {
    if (spinning || waiting) return
    setText(secureShuffle(options).join('\n'))
    setWinner(null)
  }

  const crossOutWinner = () => {
    if (!winner || eliminated.has(winner) || spinning || waiting) return
    setEliminated((items) => new Set(items).add(winner))
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
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
          <button className="icon-button" type="button" onClick={() => setShowAudit(true)} title="Проверка честности">⌁</button>
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
                <div className="winner-card">
                  <div><span>{eliminated.has(winner) ? (mode === 'elimination' ? 'Выбывает' : 'Зачёркнут') : 'Победитель'}</span><strong>{winner}</strong></div>
                  {!eliminated.has(winner) && <button type="button" onClick={crossOutWinner}><kbd>S</kbd> Зачеркнуть</button>}
                </div>
              ) : <div className="result-placeholder"><span>Результат появится здесь</span><strong>Колесо ещё не вращалось</strong></div>}
              {error && <div className="error-card">{error}</div>}
            </div>
          </div>

          <div className="wheel-area">
            <Wheel items={activeOptions} rotation={rotation} spinning={spinning} waiting={waiting} onSpin={() => void spin()} onFinished={finishSpin} />
            <div className="wheel-status" aria-live="polite">
              {waiting && <><span className="status-spinner" /> Собираем энтропию…</>}
              {spinning && <>Колесо решает…</>}
              {!waiting && !spinning && activeOptions.length > 1 && <>Нажмите кнопку или <kbd>Space</kbd></>}
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
              <button type="button" onClick={() => setEditing((value) => !value)}>{editing ? 'Готово' : 'Изменить'}</button>
              <span className="count-badge">{activeOptions.length} / {options.length}</span>
            </div>
          </div>

          <div className="mode-switch" role="group" aria-label="Режим колеса">
            <button className={mode === 'elimination' ? 'active' : ''} type="button" onClick={() => { setMode('elimination'); reset() }}>На выбывание</button>
            <button className={mode === 'single' ? 'active' : ''} type="button" onClick={() => { setMode('single'); reset() }}>Один выбор</button>
          </div>

          {editing ? <>
            <label className="input-label" htmlFor="options">По одному варианту на строку</label>
            <textarea id="options" value={text} onChange={(event) => updateText(event.target.value)} disabled={spinning || waiting} spellCheck="false" autoFocus />
            <div className="text-meta"><span>Пустые строки и дубли пропускаются</span><span>до 100</span></div>
          </> : <>
            <div className="input-label">Текущий список</div>
            <div className="options-display">
              {options.map((item, index) => {
                const isEliminated = eliminated.has(item)
                return <div key={item} className={isEliminated ? 'eliminated' : ''}>
                  <span className="option-number">{String(index + 1).padStart(2, '0')}</span>
                  <span className="option-name">{item}</span>
                  {isEliminated && <button type="button" title="Вернуть вариант" onClick={() => setEliminated((current) => { const next = new Set(current); next.delete(item); return next })}>↩</button>}
                </div>
              })}
            </div>
            <div className="text-meta"><span>Выпавшие варианты зачёркиваются</span><span>до 100</span></div>
          </>}

          <div className="action-grid">
            <button className="secondary-button" type="button" onClick={shuffle} disabled={options.length < 2 || spinning || waiting}><Icon>↝</Icon> Перетасовать</button>
            <button className="secondary-button" type="button" onClick={reset} disabled={spinning || waiting}><Icon>↺</Icon> Вернуть все</button>
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
          <button className="modal-close" type="button" onClick={() => setShowAudit(false)}>×</button>
          <span className="panel-kicker">Аудит</span><h2>След случайности</h2>
          {!report ? <p className="empty-audit">После первого вращения здесь появится отчёт об источниках.</p> : <>
            <div className="audit-stats"><div><strong>{report.liveSources}</strong><span>собрано</span></div><div><strong>{report.unavailableSources}</strong><span>недоступно</span></div></div>
            <div className="math-card">
              <span>Математика выбора</span>
              {lastMath ? <>
                <strong>Шанс каждого сектора: 1 / {lastMath.range} = {(100 / lastMath.range).toFixed(4)}%</strong>
                <div className="math-values">
                  <div><small>Количество секторов</small><b>N = {lastMath.range}</b></div>
                  <div><small>Случайное UInt32</small><b>x = {lastMath.candidate.toLocaleString('ru')}</b></div>
                  <div><small>Допустимая граница</small><b>{lastMath.candidate.toLocaleString('ru')} &lt; {lastMath.acceptanceLimit.toLocaleString('ru')} ✓</b></div>
                  <div><small>Подстановка</small><b>{lastMath.candidate.toLocaleString('ru')} mod {lastMath.range} = {lastMath.offset}</b></div>
                  <div><small>Выбранный сектор</small><b>index {lastMath.offset} → сектор №{lastMath.offset + 1}</b></div>
                  <div><small>Отброшено попыток</small><b>{lastMath.rejectedDraws}</b></div>
                </div>
                <small>Из верхнего края UInt32 исключено {lastMath.rejectedValues} знач.: это убирает modulo bias и сохраняет одинаковый шанс.</small>
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
