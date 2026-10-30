// The opening hook for the Leash walkthrough: the problem in one scene, the same scene on a leash, the name,
// then a chapter card that hands over to the screen recording.
import type { CSSProperties, ReactNode } from 'react'
import { AbsoluteFill, Easing, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { loadFont } from '@remotion/google-fonts/JetBrainsMono'

const { fontFamily } = loadFont('normal', { weights: ['400', '500', '700', '800'], subsets: ['latin'] })

const C = {
  bg: '#050506',
  ink: '#f2f2f2',
  muted: '#7d7f86',
  faint: '#3a3c42',
  panel: '#0d0f13',
  border: '#22252c',
  red: '#ff4d4d',
  held: '#f5b544',
  paid: '#3ddc84',
}

// Scene boundaries, in frames at 30 fps.
const S = {
  problem: { from: 0, len: 180 },
  stake: { from: 180, len: 90 },
  leashed: { from: 270, len: 130 },
  name: { from: 400, len: 95 },
  chapter: { from: 495, len: 65 },
}
export const HOOK_FRAMES = S.chapter.from + S.chapter.len

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

/** Fades a scene in over its first frames and out over its last. */
function useSceneFade(len: number, fadeIn = 10, fadeOut = 10) {
  const f = useCurrentFrame()
  return interpolate(f, [0, fadeIn, len - fadeOut, len], [0, 1, 1, 0], clamp)
}

/** Types text out from `start`, a fixed number of characters per frame. */
function typed(text: string, frame: number, start: number, perFrame = 1.4) {
  const n = Math.max(0, Math.floor((frame - start) * perFrame))
  return text.slice(0, n)
}

const Caret = ({ on }: { on: boolean }) => {
  const f = useCurrentFrame()
  return <span style={{ opacity: on && Math.floor(f / 8) % 2 === 0 ? 1 : 0, color: C.ink }}>▍</span>
}

/** Dark grid with a soft vignette, the backdrop for every scene. */
const Backdrop = () => {
  const f = useCurrentFrame()
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill style={{
        backgroundImage: `linear-gradient(${C.faint}22 1px, transparent 1px), linear-gradient(90deg, ${C.faint}22 1px, transparent 1px)`,
        backgroundSize: '48px 48px',
        backgroundPosition: `0 ${-(f * 0.15)}px`,
      }} />
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at center, transparent 30%, #000 85%)' }} />
    </AbsoluteFill>
  )
}

/** RGB-split jitter for a few frames, the "something went wrong" beat. */
function glitch(frame: number, at: number, length = 10): CSSProperties {
  const t = frame - at
  if (t < 0 || t > length) return {}
  const x = ((t * 37) % 7) - 3
  return { textShadow: `${x * 2}px 0 ${C.red}, ${-x * 2}px 0 #4dd2ff`, transform: `translateX(${x}px)` }
}

const Window = ({ title, children, style }: { title: string; children: ReactNode; style?: CSSProperties }) => (
  <div style={{ width: 1080, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, boxShadow: '0 30px 80px #000c', overflow: 'hidden', ...style }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderBottom: `1px solid ${C.border}`, color: C.muted, fontSize: 20 }}>
      <span style={{ color: C.faint }}>● ● ●</span>
      <span>{title}</span>
    </div>
    <div style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 22, minHeight: 330 }}>{children}</div>
  </div>
)

const UserMsg = ({ text }: { text: string }) => (
  <div style={{ alignSelf: 'flex-end', background: '#1b1e25', color: C.ink, padding: '12px 18px', borderRadius: 10, fontSize: 26 }}>{text}</div>
)

const AgentLine = ({ children, color = C.ink, style }: { children: ReactNode; color?: string; style?: CSSProperties }) => (
  <div style={{ color, fontSize: 26, lineHeight: 1.4, ...style }}>{children}</div>
)

const Badge = ({ color, children, appear }: { color: string; children: ReactNode; appear: number }) => {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()
  const s = spring({ frame: f - appear, fps, config: { damping: 14, stiffness: 160 } })
  if (f < appear) return null
  return (
    <div style={{
      alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderRadius: 8,
      border: `1px solid ${color}`, background: `${color}1f`, color, fontSize: 24, fontWeight: 700,
      transform: `scale(${0.85 + 0.15 * s})`, opacity: s,
    }}>{children}</div>
  )
}

// 0–6 s: an agent with a card buys the expensive thing, and nothing stops it.
const Problem = () => {
  const f = useCurrentFrame()
  const opacity = useSceneFade(S.problem.len, 12, 12)
  const ask = 'Buy the data we need for the report.'
  const reply = 'Fastest way: the bulk export.'
  const tool = '→ pay("DATA API", $400.00)'
  const charged = f >= 128
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity }}>
      <Window title="agent://shopping-agent · has your card">
        {f >= 14 && <UserMsg text={typed(ask, f, 14, 1.6) || ' '} />}
        {f >= 54 && <AgentLine>{typed(reply, f, 54, 1.2)}<Caret on={f < 82} /></AgentLine>}
        {f >= 92 && <AgentLine color={C.muted}>{typed(tool, f, 92, 1.4)}</AgentLine>}
        {charged && (
          <AgentLine color={C.red} style={{ fontWeight: 800, fontSize: 34, ...glitch(f, 128, 14) }}>
            CHARGED $400.00 <span style={{ fontWeight: 400, fontSize: 24, color: C.muted }}>· no one approved it</span>
          </AgentLine>
        )}
      </Window>
      {/* A red flash on the charge. */}
      <AbsoluteFill style={{ background: C.red, opacity: interpolate(f, [128, 131, 140], [0, 0.18, 0], clamp), pointerEvents: 'none' }} />
    </AbsoluteFill>
  )
}

// 6–9 s: the stake, said plainly.
const Stake = () => {
  const f = useCurrentFrame()
  const opacity = useSceneFade(S.stake.len, 8, 10)
  const line2 = interpolate(f, [38, 50], [0, 1], clamp)
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity, gap: 26 }}>
      <div style={{ color: C.ink, fontSize: 46 }}>{typed('Your AI agent can spend your money.', f, 4, 1.6)}</div>
      <div style={{ color: C.ink, fontSize: 52, fontWeight: 800, opacity: line2, textShadow: `0 0 24px ${C.ink}88` }}>Nothing says no.</div>
    </AbsoluteFill>
  )
}

// 9–13 s: the same request, with the rules in a contract.
const Leashed = () => {
  const f = useCurrentFrame()
  const opacity = useSceneFade(S.leashed.len, 10, 12)
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity }}>
      <Window title="agent://shopping-agent · on a Leash">
        <UserMsg text="Buy the data we need for the report." />
        {f >= 10 && <AgentLine color={C.muted}>{typed('→ leash_pay("DATA API", $0.30, "bulk export")', f, 10, 2)}</AgentLine>}
        <Badge color={C.held} appear={36}>HELD <span style={{ fontWeight: 400, color: C.ink }}>· over your $0.25 limit · waiting for your yes</span></Badge>
        {f >= 58 && <AgentLine color={C.muted}>{typed('→ leash_pay("DATA API", $0.05, "1 query")', f, 58, 2)}</AgentLine>}
        <Badge color={C.paid} appear={82}>PAID ALONE <span style={{ fontWeight: 400, color: C.ink }}>· 0.05 USDC moved, inside your rules</span></Badge>
      </Window>
    </AbsoluteFill>
  )
}

// 13–16 s: the name and the claim.
const Name = () => {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()
  const opacity = useSceneFade(S.name.len, 8, 10)
  const pop = spring({ frame: f, fps, config: { damping: 16, stiffness: 120 } })
  const sub = interpolate(f, [18, 32], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) })
  const foot = interpolate(f, [40, 54], [0, 1], clamp)
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity }}>
      <div style={{ color: C.ink, fontSize: 150, fontWeight: 800, letterSpacing: -4, transform: `scale(${0.9 + 0.1 * pop})`, textShadow: `0 0 40px ${C.ink}66` }}>Leash</div>
      <div style={{ color: C.ink, fontSize: 36, marginTop: 18, opacity: sub, transform: `translateY(${(1 - sub) * 12}px)` }}>
        Your agent pays on its own. Above your line, it has to ask.
      </div>
      <div style={{ color: C.muted, fontSize: 22, marginTop: 40, opacity: foot, letterSpacing: 2 }}>
        LIVE ON ARC MAINNET · REAL USDC · RULES ENFORCED BY A CONTRACT
      </div>
    </AbsoluteFill>
  )
}

// 16–18 s: hand over to the walkthrough.
const Chapter = () => {
  const f = useCurrentFrame()
  const opacity = useSceneFade(S.chapter.len, 8, 6)
  const line = interpolate(f, [10, 30], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) })
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity }}>
      <div style={{ color: C.muted, fontSize: 20, letterSpacing: 6, marginBottom: 14 }}>THE PROBLEM, ON A LEASH</div>
      <div style={{ color: C.ink, fontSize: 64, fontWeight: 800, textShadow: `0 0 26px ${C.ink}77` }}>What does it do?</div>
      <div style={{ height: 4, width: 360 * line, background: C.ink, marginTop: 16, borderRadius: 2, boxShadow: `0 0 16px ${C.ink}` }} />
    </AbsoluteFill>
  )
}

export const Hook = () => (
  <AbsoluteFill style={{ fontFamily }}>
    <Backdrop />
    <Sequence from={S.problem.from} durationInFrames={S.problem.len}><Problem /></Sequence>
    <Sequence from={S.stake.from} durationInFrames={S.stake.len}><Stake /></Sequence>
    <Sequence from={S.leashed.from} durationInFrames={S.leashed.len}><Leashed /></Sequence>
    <Sequence from={S.name.from} durationInFrames={S.name.len}><Name /></Sequence>
    <Sequence from={S.chapter.from} durationInFrames={S.chapter.len}><Chapter /></Sequence>
  </AbsoluteFill>
)
