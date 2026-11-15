export {
  isPlaylistOrEpisodeSupported,
  markPlaylistActionTriggered,
  clearPlaylistActionTrigger,
  matchPlaylistClickForHostname,
  checkAndBroadcastPlaylistNavigation,
  bootstrapContentScript
} from './syncEngine';

import { bootstrapContentScript } from './syncEngine';

bootstrapContentScript();
