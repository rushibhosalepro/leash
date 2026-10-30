import { Composition } from 'remotion'
import { Hook, HOOK_FRAMES } from './Hook'

export const Root = () => (
  <Composition id="Hook" component={Hook} durationInFrames={HOOK_FRAMES} fps={30} width={1920} height={1080} />
)
