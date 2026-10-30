import { Composition } from 'remotion'
import { Hook, HOOK_FRAMES } from './Hook'

export const Root = () => (
  <>
    <Composition id="Hook" component={Hook} durationInFrames={HOOK_FRAMES} fps={30} width={1920} height={1080} defaultProps={{ captions: true, music: true }} />
    {/* For recording your own voiceover on top. */}
    <Composition id="HookNoCaptions" component={Hook} durationInFrames={HOOK_FRAMES} fps={30} width={1920} height={1080} defaultProps={{ captions: false }} />
  </>
)
