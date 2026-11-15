export type PlaybackStateProvider = () => {
  isInRoom: boolean;
  roomPlaybackState: 'PLAYING' | 'PAUSED' | 'IDLE';
  lastSyncedTime: number;
  setLastSyncedTime: (t: number) => void;
  markProgrammatic: (ms?: number) => void;
  safePlayVideo: (video: HTMLVideoElement) => void;
};

export interface VideoPlatformAdapter {
  id: string;
  hostnames: string[];
  findVideo: (currentTargetVideo: HTMLVideoElement | null) => HTMLVideoElement | null;
  isAdPlaying?: () => boolean;
  prepareSourceForSync?: (
    video: HTMLVideoElement,
    targetTime: number,
    shouldPlay: boolean,
    ctx: PlaybackStateProvider
  ) => boolean;
  applyPlay?: (video: HTMLVideoElement, ctx: PlaybackStateProvider) => boolean;
  applyPause?: (video: HTMLVideoElement) => boolean;
  applySeek?: (video: HTMLVideoElement, targetTime: number) => boolean;
  applyPlaybackRate?: (video: HTMLVideoElement, rate: number) => void;
  isPlaylistSupported?: (loc: Location) => boolean;
  playlistClickSelector?: string;
  playlistIgnoreSelector?: string;
  playlistClickLabel?: string;
  enablePlayCaptureLock?: boolean;
  shouldIgnoreCapturePlay?: (video: HTMLVideoElement, loc: Location) => boolean;
}
