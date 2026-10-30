// Synthesizes the intro's music bed: original, so there is nothing to license, and timed to the video's beats.
// Dark A-minor drone, a heartbeat pulse, glitch bursts, a riser into the reveal, impacts, and chimes for paid / held.
// Run: bun run scripts/make-music.ts   ->  public/leash-intro.wav
import { mkdirSync, writeFileSync } from 'node:fs'

const RATE = 44100
const SECONDS = 40
const N = RATE * SECONDS
const L = new Float32Array(N)
const R = new Float32Array(N)

// Moments in the video, in seconds (scene start + the frame where the beat lands).
const GLITCHES = [62 / 30, 4 + 88 / 30, 27 + 34 / 30]
const IMPACTS = [10.1, 34.0]
const PAID_AT = 16 + 86 / 30
const HELD_AT = 16 + 182 / 30

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)
// Deterministic noise, so every render sounds the same.
let seed = 7
const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 31) - 1

function add(at: number, len: number, fn: (t: number, i: number) => [number, number]) {
  const start = Math.max(0, Math.floor(at * RATE)), end = Math.min(N, Math.floor((at + len) * RATE))
  for (let i = start; i < end; i++) {
    const [l, r] = fn((i - start) / RATE, i)
    L[i] += l; R[i] += r
  }
}

// Drone: A2, E3, C4, A3, slightly detuned per side, with a slow swell. Lifts a little after the reveal.
const chord = [45, 52, 60, 57].map(hz)
add(0, SECONDS, (t) => {
  const swell = 0.55 + 0.45 * Math.sin(2 * Math.PI * t / 8 - Math.PI / 2)
  const lift = t > 10 ? 1.25 : 1
  let l = 0, r = 0
  chord.forEach((f, k) => {
    const a = (k === 0 ? 0.09 : 0.05) * swell * lift
    l += a * Math.sin(2 * Math.PI * f * t + k)
    r += a * Math.sin(2 * Math.PI * f * 1.003 * t + k * 1.7)
  })
  return [l, r]
})

// Heartbeat: a soft low thump, twice per beat at 72 bpm, from 1 s; stops under the close.
const beat = 60 / 72
for (let b = 1; b < 33.5; b += beat) {
  for (const off of [0, 0.22]) {
    add(b + off, 0.35, (t) => {
      const f = 55 * (1 + 2.5 * Math.exp(-t * 30))
      const v = (off ? 0.22 : 0.32) * Math.exp(-t * 9) * Math.sin(2 * Math.PI * f * t)
      return [v, v]
    })
  }
}

// Glitch bursts: chopped, bit-crushed noise.
for (const g of GLITCHES) {
  add(g, 0.4, (t) => {
    const chop = Math.floor(t * 40) % 3 === 0 ? 0 : 1
    const v = 0.22 * chop * Math.exp(-t * 6) * Math.round(noise() * 4) / 4
    return [v, -v * 0.8]
  })
}

// Riser into the reveal: filtered noise and a rising tone.
add(8, 2.1, (t) => {
  const p = t / 2.1
  const tone = 0.08 * p * p * Math.sin(2 * Math.PI * (200 + 900 * p * p) * t)
  const hiss = 0.06 * p * p * noise()
  return [tone + hiss, tone - hiss]
})

// Impacts: a sub drop with a noise crack.
for (const at of IMPACTS) {
  add(at, 2.4, (t) => {
    const f = 42 + 80 * Math.exp(-t * 12)
    const sub = 0.5 * Math.exp(-t * 2.2) * Math.sin(2 * Math.PI * f * t)
    const crack = 0.18 * Math.exp(-t * 25) * noise()
    return [sub + crack, sub + crack]
  })
}

// Bell-like tone (a few inharmonic partials).
const bell = (f: number, amp: number) => (t: number): [number, number] => {
  const v = amp * Math.exp(-t * 3) * (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t * 4))
  return [v, v * 0.9]
}
// Paid: two bright rising notes. Held: one lower note that hangs.
add(PAID_AT, 1.4, bell(hz(81), 0.12))
add(PAID_AT + 0.12, 1.4, bell(hz(88), 0.11))
add(HELD_AT, 2.2, (t) => {
  const v = 0.12 * Math.exp(-t * 1.2) * Math.sin(2 * Math.PI * hz(69) * t) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 5 * t))
  return [v, v]
})

// Master: fade in, fade out over the last 2 s, soft clip, normalise to -3 dBFS.
let peak = 0
for (let i = 0; i < N; i++) {
  const t = i / RATE
  const g = Math.min(1, t / 0.3) * Math.min(1, (SECONDS - t) / 2)
  L[i] = Math.tanh(L[i] * g * 1.2); R[i] = Math.tanh(R[i] * g * 1.2)
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]))
}
const norm = 0.708 / peak

// 16-bit stereo PCM WAV.
const data = Buffer.alloc(N * 4)
for (let i = 0; i < N; i++) {
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * norm)) * 32767), i * 4)
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * norm)) * 32767), i * 4 + 2)
}
const header = Buffer.alloc(44)
header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8)
header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22)
header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34)
header.write('data', 36); header.writeUInt32LE(data.length, 40)

mkdirSync(new URL('../public/', import.meta.url), { recursive: true })
writeFileSync(new URL('../public/leash-intro.wav', import.meta.url), Buffer.concat([header, data]))
console.log(`wrote public/leash-intro.wav · ${SECONDS}s · peak before normalise ${peak.toFixed(2)}`)
