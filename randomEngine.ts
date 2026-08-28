/**
 * Browser randomness engine for the wheel.
 * Web Crypto is the security root; public data is only an extra input. Every
 * enabled source is sampled twice, length-prefixed, and mixed with SHA-256.
 */

const TIMEOUT_MS = 2_500
const UINT32_SIZE = 0x1_0000_0000

export type EntropySample = {
  source: string
  label: string
  value: string | number
  status: 'live' | 'unavailable'
  pass: 1 | 2
  collectedAt: number
}

export type EntropyProvider = (
  pass: 1 | 2,
  signal: AbortSignal,
) => Promise<EntropySample | EntropySample[]> | EntropySample | EntropySample[]

export type RandomEngineOptions = {
  /** Offline mode is just as secure; it only omits public context. */
  includeNetwork?: boolean
  timeoutMs?: number
  /** Add opt-in microphone/camera/GPS/sensor data here after user consent. */
  extraEntropyProviders?: EntropyProvider[]
}

export type EntropyReport = {
  samples: EntropySample[]
  digestHex: string
  liveSources: number
  unavailableSources: number
  /** Diagnostic only. The actual mixer uses all length-prefixed bytes. */
  numericSum: number
}

export type SelectionMath = {
  /** Number of equally likely outcomes. */
  range: number
  /** Actual accepted unsigned 32-bit value. */
  candidate: number
  /** Values from this boundary through 2^32-1 are rejected. */
  acceptanceLimit: number
  rejectedValues: number
  rejectedDraws: number
  offset: number
}

export type DiceRoll = {
  dice: [number, number]
  total: number
  seed: number
  samples: EntropySample[]
  formula: string
  digestHex: string
}

type Place = { name: string; latitude: number; longitude: number }

const cities: Place[] = [
  { name: 'Москва', latitude: 55.7558, longitude: 37.6173 },
  { name: 'Нью-Йорк', latitude: 40.7128, longitude: -74.006 },
  { name: 'Токио', latitude: 35.6762, longitude: 139.6503 },
  { name: 'Рейкьявик', latitude: 64.1466, longitude: -21.9426 },
  { name: 'Сидней', latitude: -33.8688, longitude: 151.2093 },
  { name: 'Каир', latitude: 30.0444, longitude: 31.2357 },
  { name: 'Буэнос-Айрес', latitude: -34.6037, longitude: -58.3816 },
  { name: 'Кейптаун', latitude: -33.9249, longitude: 18.4241 },
  { name: 'Анкоридж', latitude: 61.2181, longitude: -149.9003 },
  { name: 'Дубай', latitude: 25.2048, longitude: 55.2708 },
  { name: 'Сингапур', latitude: 1.3521, longitude: 103.8198 },
  { name: 'Ушуая', latitude: -54.8019, longitude: -68.303 },
  { name: 'Нуук', latitude: 64.1814, longitude: -51.6941 },
  { name: 'Мумбаи', latitude: 19.076, longitude: 72.8777 },
  { name: 'Мехико', latitude: 19.4326, longitude: -99.1332 },
  { name: 'Владивосток', latitude: 43.1155, longitude: 131.8855 },
]

const oceans: Place[] = [
  { name: 'Северная Атлантика', latitude: 47.5, longitude: -30 },
  { name: 'Южная Атлантика', latitude: -35, longitude: -15 },
  { name: 'Северный Тихий океан', latitude: 35, longitude: -155 },
  { name: 'Южный Тихий океан', latitude: -30, longitude: -120 },
  { name: 'Индийский океан', latitude: -20, longitude: 75 },
  { name: 'Норвежское море', latitude: 68, longitude: 5 },
]

const encoder = new TextEncoder()
const capturedEvents: string[] = []
let captureInstalled = false

const cryptoApi = (): Crypto => {
  if (!globalThis.crypto?.getRandomValues || !globalThis.crypto.subtle) {
    throw new Error('Для честного выбора требуется Web Crypto (HTTPS или localhost).')
  }
  return globalThis.crypto
}

const randomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length)
  cryptoApi().getRandomValues(bytes)
  return bytes
}

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

const frame = (value: string | Uint8Array): Uint8Array => {
  const body = typeof value === 'string' ? encoder.encode(value) : value
  const result = new Uint8Array(body.length + 4)
  new DataView(result.buffer).setUint32(0, body.length)
  result.set(body, 4)
  return result
}

const sha256 = async (...values: (string | Uint8Array)[]): Promise<Uint8Array> => {
  const parts = values.map(frame)
  const input = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    input.set(part, offset)
    offset += part.length
  }
  return new Uint8Array(await cryptoApi().subtle.digest('SHA-256', input))
}

const canonicalJson = (value: unknown): string => {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
}

const read = (value: unknown, ...path: (string | number)[]): unknown => {
  let current = value
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string | number, unknown>)[key]
  }
  return current
}

const live = (pass: 1 | 2, source: string, label: string, value: string | number): EntropySample =>
  ({ source, label, value, status: 'live', pass, collectedAt: Date.now() })

const unavailable = (pass: 1 | 2, source: string, label: string): EntropySample =>
  ({ source, label, value: 'unavailable', status: 'unavailable', pass, collectedAt: Date.now() })

const perfNow = (): number => typeof performance === 'undefined' ? 0 : performance.now()

const fetchJson = async (
  url: string,
  signal: AbortSignal,
  init?: RequestInit,
): Promise<{ json: unknown; latency: number }> => {
  const started = perfNow()
  const response = await fetch(url, { ...init, signal, cache: 'no-store' })
  const latency = perfNow() - started
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return { json: await response.json(), latency }
}

const fetchText = async (
  url: string,
  signal: AbortSignal,
): Promise<{ text: string; latency: number }> => {
  const started = perfNow()
  const response = await fetch(url, { signal, cache: 'no-store' })
  const latency = perfNow() - started
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return { text: await response.text(), latency }
}

/** Captures only timings/coordinates already exposed to the page; no permission prompt. */
export const startInteractionEntropyCapture = (): (() => void) => {
  if (captureInstalled || typeof window === 'undefined') return () => undefined
  captureInstalled = true
  let previous = perfNow()
  const capture = (event: Event) => {
    const current = perfNow()
    let detail = `${event.type}:${current.toFixed(5)}:${(current - previous).toFixed(5)}`
    previous = current
    if (event instanceof PointerEvent) detail += `:${event.clientX}:${event.clientY}:${event.pressure}`
    if (event.type === 'devicemotion') {
      const motion = event as DeviceMotionEvent
      const acceleration = motion.accelerationIncludingGravity
      const rotation = motion.rotationRate
      detail += `:${acceleration?.x}:${acceleration?.y}:${acceleration?.z}`
      detail += `:${rotation?.alpha}:${rotation?.beta}:${rotation?.gamma}`
    }
    capturedEvents.push(detail)
    if (capturedEvents.length > 256) capturedEvents.shift()
  }
  const names = ['pointermove', 'pointerdown', 'keydown', 'touchmove', 'devicemotion'] as const
  for (const name of names) window.addEventListener(name, capture, { passive: true })
  return () => {
    for (const name of names) window.removeEventListener(name, capture)
    captureInstalled = false
  }
}

const abortableDelay = (milliseconds: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(resolve, milliseconds)
    signal.addEventListener('abort', () => {
      globalThis.clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })

/** Opt-in provider: pass it via `extraEntropyProviders` after explaining the GPS prompt. */
export const geolocationEntropyProvider: EntropyProvider = (pass, signal) =>
  new Promise<EntropySample>((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(unavailable(pass, 'device.gps', 'GPS и его колебания'))
      return
    }
    let settled = false
    const finish = (sample: EntropySample) => {
      if (!settled) {
        settled = true
        resolve(sample)
      }
    }
    signal.addEventListener('abort', () => finish(unavailable(pass, 'device.gps', 'GPS и его колебания')), { once: true })
    navigator.geolocation.getCurrentPosition(
      (position) => finish(live(pass, 'device.gps', 'GPS и его колебания', canonicalJson({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        altitude: position.coords.altitude,
        accuracy: position.coords.accuracy,
        heading: position.coords.heading,
        speed: position.coords.speed,
        timestamp: position.timestamp,
      }))),
      () => finish(unavailable(pass, 'device.gps', 'GPS и его колебания')),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 },
    )
  })

/** Opt-in provider. Calling it can show the browser's microphone permission dialog. */
export const microphoneEntropyProvider: EntropyProvider = async (pass, signal) => {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return unavailable(pass, 'device.microphone', 'шум микрофона')
  }
  let stream: MediaStream | undefined
  let context: AudioContext | undefined
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    context = new AudioContext()
    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 2048
    source.connect(analyser)
    await abortableDelay(180, signal)
    const samples = new Uint8Array(analyser.fftSize)
    analyser.getByteTimeDomainData(samples)
    const digest = await sha256('microphone/v1', samples, String(perfNow()))
    return live(pass, 'device.microphone', 'шум микрофона', hex(digest))
  } catch {
    return unavailable(pass, 'device.microphone', 'шум микрофона')
  } finally {
    stream?.getTracks().forEach((track) => track.stop())
    if (context && context.state !== 'closed') await context.close().catch(() => undefined)
  }
}

/** Opt-in provider. Calling it can show the browser's camera permission dialog. */
export const cameraEntropyProvider: EntropyProvider = async (pass, signal) => {
  if (typeof document === 'undefined' || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return unavailable(pass, 'device.camera', 'шум матрицы камеры')
  }
  let stream: MediaStream | undefined
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true })
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const video = document.createElement('video')
    video.srcObject = stream
    video.muted = true
    await video.play()
    await abortableDelay(180, signal)
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Canvas is unavailable')
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    const pixels = new Uint8Array(context.getImageData(0, 0, canvas.width, canvas.height).data.buffer)
    const digest = await sha256('camera/v1', pixels, String(perfNow()))
    video.srcObject = null
    return live(pass, 'device.camera', 'шум матрицы камеры', hex(digest))
  } catch {
    return unavailable(pass, 'device.camera', 'шум матрицы камеры')
  } finally {
    stream?.getTracks().forEach((track) => track.stop())
  }
}

const localSamples = (pass: 1 | 2): EntropySample[] => {
  const jitter: number[] = []
  for (let index = 0; index < 64; index += 1) {
    const before = perfNow()
    const after = perfNow()
    jitter.push(Math.round((after - before + after) * 1_000_000))
  }
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  const screenInfo = typeof screen === 'undefined' ? undefined : screen
  const memory = typeof performance !== 'undefined' && 'memory' in performance
    ? (performance as Performance & { memory?: unknown }).memory : undefined
  const connection = nav && 'connection' in nav
    ? (nav as Navigator & { connection?: unknown }).connection : undefined

  return [
    live(pass, 'browser.crypto', 'Web Crypto, 256 бит', hex(randomBytes(32))),
    live(pass, 'local.time', 'Unix timestamp + high-resolution time', `${Date.now()}:${perfNow()}`),
    live(pass, 'local.jitter', 'микротайминги выполнения', jitter.join(',')),
    live(pass, 'local.device', 'доступные параметры устройства', canonicalJson({
      cores: nav?.hardwareConcurrency,
      deviceMemory: nav && 'deviceMemory' in nav
        ? (nav as Navigator & { deviceMemory?: number }).deviceMemory : undefined,
      language: nav?.language,
      screen: screenInfo && [screenInfo.width, screenInfo.height, screenInfo.colorDepth],
      memory,
      connection,
    })),
    live(pass, 'local.interaction', 'мышь/касания/клавиши', capturedEvents.join('|') || 'no-events-yet'),
  ]
}

const weather: EntropyProvider = async (pass, signal) => {
  const city = cities[randomIntInclusive(0, cities.length - 1)]
  try {
    const fields = 'temperature_2m,relative_humidity_2m,pressure_msl,wind_speed_10m'
    const result = await fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${city.latitude}&longitude=${city.longitude}&current=${fields}`, signal)
    return [
      live(pass, 'open-meteo.weather', `погода: ${city.name}`, canonicalJson(read(result.json, 'current'))),
      live(pass, 'network.open-meteo', 'ping Open-Meteo, мс', result.latency),
    ]
  } catch {
    return [unavailable(pass, 'open-meteo.weather', `погода: ${city.name}`), unavailable(pass, 'network.open-meteo', 'ping Open-Meteo')]
  }
}

const marine: EntropyProvider = async (pass, signal) => {
  const point = oceans[randomIntInclusive(0, oceans.length - 1)]
  try {
    const result = await fetchJson(`https://marine-api.open-meteo.com/v1/marine?latitude=${point.latitude}&longitude=${point.longitude}&current=wave_height,sea_surface_temperature`, signal)
    return [
      live(pass, 'open-meteo.marine', `волны/океан: ${point.name}`, canonicalJson(read(result.json, 'current'))),
      live(pass, 'network.marine', 'ping Marine API, мс', result.latency),
    ]
  } catch {
    return [unavailable(pass, 'open-meteo.marine', `волны/океан: ${point.name}`), unavailable(pass, 'network.marine', 'ping Marine API')]
  }
}

const simpleProvider = (
  source: string,
  label: string,
  url: string,
  select: (json: unknown) => unknown = (json) => json,
): EntropyProvider => async (pass, signal) => {
  try {
    const result = await fetchJson(url, signal)
    return [
      live(pass, source, label, canonicalJson(select(result.json))),
      live(pass, `network.${source}`, `ping ${label}, мс`, result.latency),
    ]
  } catch {
    return [unavailable(pass, source, label), unavailable(pass, `network.${source}`, `ping ${label}`)]
  }
}

const bitcoin: EntropyProvider = async (pass, signal) => {
  try {
    const latest = await fetchText('https://blockstream.info/api/blocks/tip/hash', signal)
    const hash = latest.text.trim()
    if (!/^[0-9a-f]{64}$/i.test(hash)) throw new Error('No block hash')
    const raw = await fetchJson(`https://blockstream.info/api/block/${hash}`, signal)
    return [
      live(pass, 'bitcoin.block', 'hash/номер/размер/tx блока Bitcoin', canonicalJson({
        hash, height: read(raw.json, 'height'), size: read(raw.json, 'size'),
        transactions: read(raw.json, 'tx_count'), time: read(raw.json, 'timestamp'),
      })),
      live(pass, 'network.bitcoin', 'ping Bitcoin API, мс', latest.latency + raw.latency),
    ]
  } catch {
    return [unavailable(pass, 'bitcoin.block', 'последний блок Bitcoin'), unavailable(pass, 'network.bitcoin', 'ping Bitcoin API')]
  }
}

const ethereum: EntropyProvider = async (pass, signal) => {
  try {
    const result = await fetchJson('https://ethereum-rpc.publicnode.com', signal, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: pass }),
    })
    const block = String(read(result.json, 'result') ?? '')
    if (!/^0x[0-9a-f]+$/i.test(block)) throw new Error('Invalid block')
    return [live(pass, 'ethereum.block', 'номер блока Ethereum', Number.parseInt(block.slice(2), 16)), live(pass, 'network.ethereum', 'ping Ethereum RPC, мс', result.latency)]
  } catch {
    return [unavailable(pass, 'ethereum.block', 'номер блока Ethereum'), unavailable(pass, 'network.ethereum', 'ping Ethereum RPC')]
  }
}

const solar: EntropyProvider = async (pass, signal) => {
  try {
    const [field, speed] = await Promise.all([
      fetchJson('https://services.swpc.noaa.gov/products/summary/solar-wind-mag-field.json', signal),
      fetchJson('https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json', signal),
    ])
    return [live(pass, 'noaa.solar', 'солнечный ветер/магнитное поле', canonicalJson({ field: field.json, speed: speed.json })), live(pass, 'network.noaa', 'ping NOAA, мс', field.latency + speed.latency)]
  } catch {
    return [unavailable(pass, 'noaa.solar', 'солнечный ветер/магнитное поле'), unavailable(pass, 'network.noaa', 'ping NOAA')]
  }
}

const networkProviders: EntropyProvider[] = [
  weather,
  marine,
  simpleProvider('coingecko', 'BTC/ETH USD/EUR', 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd,eur'),
  simpleProvider('frankfurter', 'курсы USD', 'https://api.frankfurter.app/latest?from=USD&to=EUR,GBP,JPY,RUB', (json) => read(json, 'rates')),
  bitcoin,
  ethereum,
  solar,
  simpleProvider('usgs.earthquake', 'последнее землетрясение', 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&limit=1&orderby=time', (json) => {
    const feature = read(json, 'features', 0)
    return { coordinates: read(feature, 'geometry', 'coordinates'), magnitude: read(feature, 'properties', 'mag'), time: read(feature, 'properties', 'time'), id: read(feature, 'id') }
  }),
  simpleProvider('safecast.radiation', 'радиационный фон Safecast', 'https://api.safecast.org/measurements.json?order=captured_at%20desc&per_page=1'),
  simpleProvider('anu.qrng', 'квантовый шум ANU', 'https://qrng.anu.edu.au/API/jsonI.php?length=4&type=uint16'),
]

const collectPass = async (pass: 1 | 2, options: RandomEngineOptions): Promise<EntropySample[]> => {
  const controller = new AbortController()
  const timer = globalThis.setTimeout(() => controller.abort(), Math.max(250, options.timeoutMs ?? TIMEOUT_MS))
  const providers = [...(options.includeNetwork === false ? [] : networkProviders), ...(options.extraEntropyProviders ?? [])]
  try {
    const batches = await Promise.all(providers.map(async (provider, index) => {
      try {
        const result = await provider(pass, controller.signal)
        return Array.isArray(result) ? result : [result]
      } catch {
        return [unavailable(pass, `custom.${index}`, `дополнительный источник ${index + 1}`)]
      }
    }))
    return [...localSamples(pass), ...batches.flat()]
  } finally {
    globalThis.clearTimeout(timer)
  }
}

const serializeSample = (sample: EntropySample): string => canonicalJson(sample)

/** Collects every enabled source twice and mixes both snapshots. */
export const collectEntropy = async (options: RandomEngineOptions = {}): Promise<{
  pool: Uint8Array
  report: EntropyReport
}> => {
  // Independent secret roots are drawn before any attacker-controlled network I/O.
  const coreOne = randomBytes(32)
  const coreTwo = randomBytes(32)
  const [passOne, passTwo] = await Promise.all([collectPass(1, options), collectPass(2, options)])
  const samples = [...passOne, ...passTwo]
  const pool = await sha256('wheel-random/v2', coreOne, ...passOne.map(serializeSample), coreTwo, ...passTwo.map(serializeSample))
  coreOne.fill(0)
  coreTwo.fill(0)
  const numericSum = samples.reduce((sum, sample) => {
    const number = typeof sample.value === 'number' ? sample.value : Number(sample.value)
    return Number.isFinite(number) ? sum + number : sum
  }, 0)
  return { pool, report: {
    samples, digestHex: hex(pool), numericSum,
    liveSources: samples.filter((sample) => sample.status === 'live').length,
    unavailableSources: samples.filter((sample) => sample.status === 'unavailable').length,
  } }
}

const uint32 = (bytes: Uint8Array, offset = 0): number =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset)

const rangeInfo = (a: number, b: number): [number, number] => {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) throw new RangeError('Границы должны быть безопасными целыми числами.')
  const min = Math.min(a, b)
  const range = Math.max(a, b) - min + 1
  if (range < 1 || range > UINT32_SIZE) throw new RangeError(`Диапазон должен содержать не более ${UINT32_SIZE} значений.`)
  return [min, range]
}

const unbiased = (range: number, next: () => number): number => {
  const limit = UINT32_SIZE - (UINT32_SIZE % range)
  let value: number
  do value = next()
  while (value >= limit)
  return value % range
}

const unbiasedFromPool = async (range: number, pool: Uint8Array, domain: string): Promise<SelectionMath> => {
  const limit = UINT32_SIZE - (UINT32_SIZE % range)
  let block = pool
  let counter = 0
  let offset = 0
  let rejectedDraws = 0
  while (true) {
    if (offset + 4 > block.length) {
      block = await sha256(domain, pool, String(++counter))
      offset = 0
    }
    const value = uint32(block, offset)
    offset += 4
    if (value < limit) return {
      range,
      candidate: value,
      acceptanceLimit: limit,
      rejectedValues: UINT32_SIZE - limit,
      rejectedDraws,
      offset: value % range,
    }
    rejectedDraws += 1
  }
}

/** Instant offline CSPRNG, suitable for Fisher-Yates shuffle and UI animation. */
export const randomIntInclusive = (minimum: number, maximum: number): number => {
  const [min, range] = rangeInfo(minimum, maximum)
  return min + unbiased(range, () => uint32(randomBytes(4)))
}

/** Network-enhanced final selection with an audit report. */
export const secureRandomIntInclusive = async (
  minimum: number,
  maximum: number,
  options: RandomEngineOptions = {},
): Promise<{ value: number; report: EntropyReport; math: SelectionMath }> => {
  const [min, range] = rangeInfo(minimum, maximum)
  const { pool, report } = await collectEntropy(options)
  const math = await unbiasedFromPool(range, pool, 'wheel-random/expand/v2')
  return { value: min + math.offset, report, math }
}

export const secureRandomIndex = async <T>(items: readonly T[], options: RandomEngineOptions = {}) => {
  if (!items.length) throw new RangeError('Нельзя выбрать элемент из пустого списка.')
  const result = await secureRandomIntInclusive(0, items.length - 1, options)
  return { index: result.value, item: items[result.value], report: result.report, math: result.math }
}

export const secureShuffle = <T>(items: readonly T[]): T[] => {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = randomIntInclusive(0, index)
    ;[result[index], result[other]] = [result[other], result[index]]
  }
  return result
}

/** Compatibility with the old dice API. */
export const rollComplexDice = async (options: RandomEngineOptions = {}): Promise<DiceRoll> => {
  const { pool, report } = await collectEntropy(options)
  const secondPool = await sha256('wheel-random/die-2/v2', pool)
  const firstMath = await unbiasedFromPool(6, pool, 'wheel-random/die-1-expand/v2')
  const secondMath = await unbiasedFromPool(6, secondPool, 'wheel-random/die-2-expand/v2')
  const dice: [number, number] = [
    1 + firstMath.offset,
    1 + secondMath.offset,
  ]
  return {
    dice, total: dice[0] + dice[1], seed: uint32(pool, 4), samples: report.samples,
    digestHex: report.digestHex,
    formula: '2 × Web Crypto + 2 снимка источников → SHA-256 → rejection sampling',
  }
}
