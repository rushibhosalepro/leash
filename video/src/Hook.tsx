// The 40-second Leash intro, scene by scene to the voiceover script: the hook, the problem, Leash,
// the real mainnet payments, what the agent can't do, and the close. Captions carry the voiceover
// so the video still works muted.
import type { CSSProperties, ReactNode } from 'react'
import { AbsoluteFill, Audio, Easing, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { loadFont } from '@remotion/google-fonts/JetBrainsMono'

const { fontFamily } = loadFont('normal', { weights: ['400', '500', '700', '800'], subsets: ['latin'] })

const C = {
  bg: '#050506',
  ink: '#f2f2f2',
  muted: '#8a8c93',
  faint: '#3a3c42',
  panel: '#0d0f13',
  border: '#22252c',
  red: '#ff4d4d',
  held: '#f5b544',
  paid: '#3ddc84',
}

const sec = (s: number) => Math.round(s * 30)

// Scene boundaries follow the script's timecodes.
const S = {
  hook: { from: 0, len: sec(4) },
  problem: { from: sec(4), len: sec(6) },
  meet: { from: sec(10), len: sec(6) },
  proof: { from: sec(16), len: sec(11) },
  rules: { from: sec(27), len: sec(7) },
  close: { from: sec(34), len: sec(6) },
}
export const HOOK_FRAMES = S.close.from + S.close.len

// The voiceover, split into caption lines with their start and end in seconds.
const CAPTIONS: [number, number, string][] = [
  [0.2, 3.9, 'What happens when your AI agent gets access to your money… and decides to spend it all?'],
  [4.1, 6.9, 'You give it a wallet to pay for API calls, tools, and services.'],
  [6.9, 9.9, 'But what happens when it decides to spend more than you intended?'],
  [10.1, 12.9, 'I built Leash. A spending control layer'],
  [12.9, 15.9, 'that lets AI agents pay on their own, without giving them control over your money.'],
  [16.1, 19.5, 'Here’s a real transaction on Arc mainnet.'],
  [19.5, 22.6, 'My agent tries to pay five cents. Paid.'],
  [22.6, 26.9, 'Then it tries to pay thirty cents. Held for my approval. The limit was twenty-five cents.'],
  [27.1, 30.4, 'The agent can’t raise its own limit, add new payees, or approve its own payments.'],
  [30.4, 33.9, 'Those permissions belong to the owner, enforced by a smart contract.'],
  [34.1, 37.0, 'AI agents should be able to spend money.'],
  [37.0, 39.9, 'They just shouldn’t control how much. That’s Leash.'],
]

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

/** Fades a scene in over its first frames and out over its last. */
function useSceneFade(len: number, fadeIn = 10, fadeOut = 10) {
  const f = useCurrentFrame()
  return interpolate(f, [0, fadeIn, len - fadeOut, len], [0, 1, 1, 0], clamp)
}

/** Types text out from `start`, a fixed number of characters per frame. */
const typed = (text: string, frame: number, start: number, perFrame = 1.4) =>
  text.slice(0, Math.max(0, Math.floor((frame - start) * perFrame)))

/** 0 → 1 as the frame passes `start`, eased. */
const rise = (frame: number, start: number, length = 14) =>
  interpolate(frame, [start, start + length], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) })

/** RGB-split jitter for a few frames, the "something went wrong" beat. */
function glitch(frame: number, at: number, length = 10): CSSProperties {
  const t = frame - at
  if (t < 0 || t > length) return {}
  const x = ((t * 37) % 7) - 3
  return { textShadow: `${x * 2}px 0 ${C.red}, ${-x * 2}px 0 #4dd2ff`, transform: `translateX(${x}px)` }
}

const glow = (color = C.ink) => ({ textShadow: `0 0 28px ${color}77` })

/** Dark grid with a soft vignette, the backdrop for every scene. */
const Backdrop = () => {
  const f = useCurrentFrame()
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill style={{
        backgroundImage: `linear-gradient(${C.faint}26 1px, transparent 1px), linear-gradient(90deg, ${C.faint}26 1px, transparent 1px)`,
        backgroundSize: '48px 48px',
        backgroundPosition: `0 ${-(f * 0.15)}px`,
      }} />
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at center, transparent 30%, #000 85%)' }} />
    </AbsoluteFill>
  )
}

const Label = ({ children, color = C.muted, style }: { children: ReactNode; color?: string; style?: CSSProperties }) => (
  <div style={{ color, fontSize: 22, letterSpacing: 6, ...style }}>{children}</div>
)

const Panel = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 16, boxShadow: '0 30px 80px #000c', ...style }}>{children}</div>
)

// 0–4 s: the line that makes you stay.
const HookScene = () => {
  const f = useCurrentFrame()
  const opacity = useSceneFade(S.hook.len, 4, 10)
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity }}>
      <div style={{ color: C.ink, fontSize: 76, fontWeight: 800, letterSpacing: -1, ...glow(), ...glitch(f, 62, 12) }}>
        {typed('YOUR AI AGENT HAS YOUR WALLET.', f, 6, 1.1)}
      </div>
    </AbsoluteFill>
  )
}

// 4–10 s: wallet handed over, a payment goes out, spending runs past what you meant.
const ProblemScene = () => {
  const f = useCurrentFrame()
  const opacity = useSceneFade(S.problem.len, 8, 10)
  const steps = [
    { at: 6, icon: '◧', text: 'Agent receives wallet access' },
    { at: 46, icon: '→', text: 'Agent initiates payment' },
    { at: 86, icon: '!', text: 'Spending goes beyond your limit', bad: true },
  ]
  // Spend bar: grows to the limit, then past it and turns red.
  const spend = interpolate(f, [56, 100, 150], [0, 0.62, 1], clamp)
  const over = spend > 0.62
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity, gap: 56 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22, width: 980 }}>
        {steps.map(s => {
          const r = rise(f, s.at)
          return (
            <div key={s.text} style={{ display: 'flex', alignItems: 'center', gap: 22, opacity: r, transform: `translateX(${(1 - r) * -24}px)` }}>
              <span style={{ width: 54, height: 54, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 800,
                border: `1px solid ${s.bad ? C.red : C.border}`, color: s.bad ? C.red : C.ink, background: s.bad ? `${C.red}1a` : C.panel }}>{s.icon}</span>
              <span style={{ color: s.bad ? C.red : C.ink, fontSize: 38, fontWeight: s.bad ? 800 : 500, ...(s.bad ? glitch(f, 88, 10) : {}) }}>{s.text}</span>
            </div>
          )
        })}
      </div>
      <div style={{ width: 980, opacity: rise(f, 50) }}>
        <div style={{ position: 'relative', height: 18, borderRadius: 9, background: '#15171c' }}>
          <div style={{ position: 'absolute', inset: 0, width: `${spend * 100}%`, borderRadius: 9, background: over ? C.red : C.ink, boxShadow: over ? `0 0 24px ${C.red}` : 'none' }} />
          <div style={{ position: 'absolute', left: '62%', top: -14, bottom: -14, width: 2, background: C.muted }} />
        </div>
        <div style={{ position: 'relative', height: 40 }}>
          <span style={{ position: 'absolute', left: '62%', transform: 'translateX(-50%)', top: 18, color: C.muted, fontSize: 20 }}>what you intended</span>
        </div>
      </div>
    </AbsoluteFill>
  )
}

// 10–16 s: Leash, and the one-line promise.
const MeetScene = () => {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()
  const opacity = useSceneFade(S.meet.len, 8, 10)
  const pop = spring({ frame: f - 4, fps, config: { damping: 16, stiffness: 120 } })
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity }}>
      <Label style={{ opacity: rise(f, 0) }}>MEET</Label>
      <div style={{ color: C.ink, fontSize: 168, fontWeight: 800, letterSpacing: -5, transform: `scale(${0.9 + 0.1 * pop})`, opacity: pop, ...glow() }}>LEASH</div>
      <div style={{ display: 'flex', gap: 28, marginTop: 26, fontSize: 40, fontWeight: 700 }}>
        <span style={{ color: C.paid, opacity: rise(f, 60) }}>Your agent can spend.</span>
        <span style={{ color: C.red, opacity: rise(f, 92) }}>It cannot change the rules.</span>
      </div>
    </AbsoluteFill>
  )
}

const Decision = ({ at, amount, color, verdict, detail, tx }: { at: number; amount: string; color: string; verdict: string; detail: string; tx: string }) => {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()
  const row = rise(f, at)
  const stamp = spring({ frame: f - at - 26, fps, config: { damping: 12, stiffness: 180 } })
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 300px', alignItems: 'center', gap: 24, padding: '26px 36px', borderTop: `1px solid ${C.border}`, opacity: row }}>
      <span style={{ color: C.ink, fontSize: 52, fontWeight: 800 }}>{amount}</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 6, opacity: f >= at + 26 ? 1 : 0 }}>
        <span style={{ alignSelf: 'flex-start', padding: '8px 16px', borderRadius: 8, border: `1px solid ${color}`, background: `${color}1f`, color, fontSize: 32, fontWeight: 800, transform: `scale(${0.8 + 0.2 * stamp})` }}>{verdict}</span>
        <span style={{ color: C.muted, fontSize: 22 }}>{detail}</span>
      </span>
      <span style={{ color: C.muted, fontSize: 20, textAlign: 'right', opacity: f >= at + 40 ? 1 : 0 }}>tx {tx}<br />explorer.arc.io</span>
    </div>
  )
}

// 16–27 s: the real mainnet payments, paid and held.
const ProofScene = () => {
  const f = useCurrentFrame()
  const opacity = useSceneFade(S.proof.len, 10, 12)
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity, gap: 30 }}>
      <Panel style={{ width: 1240, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '22px 36px' }}>
          <Label color={C.ink} style={{ fontWeight: 700 }}>AGENT PAYMENT REQUEST</Label>
          <span style={{ color: C.muted, fontSize: 20 }}>● Arc mainnet · real USDC</span>
        </div>
        <Decision at={60} amount="$0.05" color={C.paid} verdict="✓ PAID" detail="inside the rules, moved on its own" tx="0x2942…da70" />
        <Decision at={156} amount="$0.30" color={C.held} verdict="✕ HELD" detail="over the limit, waiting for the owner" tx="0x2fdc…a7c3" />
      </Panel>
      <div style={{ color: C.ink, fontSize: 34, fontWeight: 800, letterSpacing: 4, opacity: rise(f, 230), ...glow() }}>$0.25 MAX PER PAYMENT</div>
    </AbsoluteFill>
  )
}

// 27–34 s: what the agent can do, and what it never can.
const RulesScene = () => {
  const f = useCurrentFrame()
  const opacity = useSceneFade(S.rules.len, 8, 10)
  const cannot = ['raise its own limit', 'add new payees', 'approve its own payments']
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity, gap: 40 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'flex-start' }}>
        <div style={{ fontSize: 72, fontWeight: 800, color: C.ink, opacity: rise(f, 4) }}>AGENT: PAY <span style={{ color: C.paid }}>✓</span></div>
        <div style={{ fontSize: 72, fontWeight: 800, color: C.ink, opacity: rise(f, 30), ...glitch(f, 34, 10) }}>AGENT: CHANGE RULES <span style={{ color: C.red }}>✕</span></div>
      </div>
      <div style={{ display: 'flex', gap: 18 }}>
        {cannot.map((c, i) => (
          <span key={c} style={{ padding: '12px 20px', borderRadius: 10, border: `1px solid ${C.red}55`, background: `${C.red}12`, color: C.ink, fontSize: 26, opacity: rise(f, 70 + i * 12) }}>
            <span style={{ color: C.red }}>✕ </span>{c}
          </span>
        ))}
      </div>
      <div style={{ color: C.muted, fontSize: 24, opacity: rise(f, 120) }}>Owner-only in the contract. The agent’s key gets <span style={{ color: C.ink }}>NotOwner</span>.</div>
    </AbsoluteFill>
  )
}

// 34–40 s: the close.
const CloseScene = () => {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()
  const opacity = useSceneFade(S.close.len, 8, 4)
  const pop = spring({ frame: f, fps, config: { damping: 16, stiffness: 120 } })
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity }}>
      <div style={{ color: C.ink, fontSize: 160, fontWeight: 800, letterSpacing: -5, transform: `scale(${0.9 + 0.1 * pop})`, ...glow() }}>LEASH</div>
      <div style={{ color: C.ink, fontSize: 40, fontWeight: 700, marginTop: 14, opacity: rise(f, 16) }}>Give your agent a wallet. Not unlimited power.</div>
      <Label style={{ marginTop: 34, opacity: rise(f, 36) }}>BUILT ON ARC · REAL USDC · ON-CHAIN ENFORCEMENT</Label>
      <div style={{ marginTop: 38, padding: '14px 26px', borderRadius: 12, border: `1px solid ${C.border}`, background: C.panel, color: C.ink, fontSize: 30, opacity: rise(f, 56) }}>
        Try it: <span style={{ fontWeight: 800 }}>rushibhosalepro.github.io/leash</span>
      </div>
    </AbsoluteFill>
  )
}

/** The voiceover as captions, bottom centre. */
const Captions = () => {
  const f = useCurrentFrame()
  const t = f / 30
  const line = CAPTIONS.find(([a, b]) => t >= a && t < b)
  if (!line) return null
  const [a, b, text] = line
  const o = interpolate(t, [a, a + 0.15, b - 0.15, b], [0, 1, 1, 0], clamp)
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 70 }}>
      <div style={{ maxWidth: 1500, textAlign: 'center', color: C.ink, fontSize: 34, lineHeight: 1.35, padding: '10px 22px', borderRadius: 10, background: '#000000b3', opacity: o }}>{text}</div>
    </AbsoluteFill>
  )
}

export const Hook = ({ captions = true, music = false }: { captions?: boolean; music?: boolean }) => (
  <AbsoluteFill style={{ fontFamily }}>
    {/* Original music bed, made by scripts/make-music.ts and timed to these scenes. */}
    {music && <Audio src={staticFile('leash-intro.wav')} />}
    <Backdrop />
    <Sequence from={S.hook.from} durationInFrames={S.hook.len}><HookScene /></Sequence>
    <Sequence from={S.problem.from} durationInFrames={S.problem.len}><ProblemScene /></Sequence>
    <Sequence from={S.meet.from} durationInFrames={S.meet.len}><MeetScene /></Sequence>
    <Sequence from={S.proof.from} durationInFrames={S.proof.len}><ProofScene /></Sequence>
    <Sequence from={S.rules.from} durationInFrames={S.rules.len}><RulesScene /></Sequence>
    <Sequence from={S.close.from} durationInFrames={S.close.len}><CloseScene /></Sequence>
    {captions && <Captions />}
  </AbsoluteFill>
)
