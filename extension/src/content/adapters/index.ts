import { VideoPlatformAdapter } from './types';
import { findGenericVideoElement, pickBestNonAdVideo } from './videoDomUtils';
import {
  anime1Adapter,
  bahamutAdapter,
  ensureAnime1SourceReady,
  findAnime1Video,
  findNetflixVideo,
  findNiconicoVideo,
  netflixAdapter,
  niconicoAdapter,
  youtubeAdapter
} from './richAdapters';

interface DeclarativeAdapterSpec {
  id: string;
  hostnames: string[];
  videoSelector: string;
  playlistPathOrSearchCheck?: (loc: Location) => boolean;
  playlistDomSelector: string;
  playlistClickSelector: string;
  playlistClickLabel: string;
}

function createSelectorAdapter(spec: DeclarativeAdapterSpec): VideoPlatformAdapter {
  return {
    id: spec.id,
    hostnames: spec.hostnames,
    findVideo: () =>
      pickBestNonAdVideo(Array.from(document.querySelectorAll(spec.videoSelector)) as HTMLVideoElement[]) ||
      findGenericVideoElement(),
    isPlaylistSupported: (loc) => {
      if (spec.playlistPathOrSearchCheck?.(loc)) return true;
      return Boolean(document.querySelector(spec.playlistDomSelector));
    },
    playlistClickSelector: spec.playlistClickSelector,
    playlistClickLabel: spec.playlistClickLabel
  };
}

export const PLATFORM_ADAPTERS: VideoPlatformAdapter[] = [
  youtubeAdapter,
  netflixAdapter,
  niconicoAdapter,
  anime1Adapter,
  bahamutAdapter,
  createSelectorAdapter({
    id: 'bilibili',
    hostnames: ['bilibili.com'],
    videoSelector: '.bpx-player-video-wrap video, .bilibili-player-video video',
    playlistPathOrSearchCheck: (loc) => loc.pathname.toLowerCase().includes('/bangumi/play/') || loc.search.includes('p='),
    playlistDomSelector:
      '#multi_page, .cur-list, .ep-list-wrapper, .section-ep-wrapper, .bpx-player-ctrl-btn-next, .squirtle-video-next',
    playlistClickSelector:
      '.bpx-player-ctrl-btn-next, .bpx-player-ctrl-btn-prev, .squirtle-video-next, .ep-item, .section-ep-wrapper li, #multi_page .cur-list li, .part-item',
    playlistClickLabel: 'Bilibili Episode/Part Click'
  }),
  createSelectorAdapter({
    id: 'vimeo',
    hostnames: ['vimeo.com'],
    videoSelector: '.vp-video-wrapper video, .vp-video video, .player-container video',
    playlistPathOrSearchCheck: (loc) => {
      const p = loc.pathname.toLowerCase();
      return p.includes('/showcase/') || p.includes('/channels/') || p.includes('/groups/');
    },
    playlistDomSelector: '.playlist-container, .showcase-item, .vp-teleport-tray, [aria-label*="Next video"]',
    playlistClickSelector: '[aria-label*="Next video"], .vp-teleport-tray a, .showcase-item a, .vp-video-tray a',
    playlistClickLabel: 'Vimeo Next/Playlist Click'
  }),
  createSelectorAdapter({
    id: 'twitch',
    hostnames: ['twitch.tv'],
    videoSelector: 'div[data-a-target="video-player"] video, .video-player__container video',
    playlistPathOrSearchCheck: (loc) => loc.search.includes('collection='),
    playlistDomSelector: '[data-a-target="player-next-video-button"], [data-a-target="collection-item"]',
    playlistClickSelector: '[data-a-target="player-next-video-button"], [data-a-target="collection-item"]',
    playlistClickLabel: 'Twitch Next/Collection Click'
  }),
  createSelectorAdapter({
    id: 'disneyplus',
    hostnames: ['disneyplus.com'],
    videoSelector: 'video.btm-media-client, #video-player video, .hive-media-client-video, btm-media-player video, disney-web-player video',
    playlistPathOrSearchCheck: (loc) => loc.pathname.toLowerCase().includes('/series/'),
    playlistDomSelector:
      '[data-testid*="next-episode"], [data-testid*="up-next"], [aria-label*="Next Episode"], [aria-label*="下一集"], .up-next-card, [data-testid="episode-card"]',
    playlistClickSelector:
      '[data-testid*="next-episode"], [data-testid*="up-next"], .up-next-card, [aria-label*="Next Episode"], [aria-label*="下一集"]',
    playlistClickLabel: 'Disney+ Next Episode Click'
  }),
  createSelectorAdapter({
    id: 'primevideo',
    hostnames: ['primevideo.com', 'amazon.com'],
    videoSelector:
      '#dv-web-player video, .atvwebplayersdk-video-surface video, .webPlayerSDKContainer video, .webPlayerElement video, .rendererContainer video, [data-testid="web-player"] video',
    playlistDomSelector:
      '[data-testid="next-episode-button"], .next-episode, [aria-label*="Next Episode"], [aria-label*="下一集"], .dv-player-next-episode, .nextUpCard',
    playlistClickSelector:
      '[data-testid="next-episode-button"], .next-episode, [aria-label*="Next Episode"], [aria-label*="下一集"], .nextUpCard',
    playlistClickLabel: 'Prime Video Next Episode Click'
  }),
  createSelectorAdapter({
    id: 'myvideo',
    hostnames: ['myvideo.net.tw'],
    videoSelector: '#video_player_html5_api, #playerContainer video, video.vjs-tech',
    playlistPathOrSearchCheck: (loc) => loc.pathname.toLowerCase().includes('/details/3/'),
    playlistDomSelector: '.episode-item, .episode_list, .drama-episode, .season-list, [data-testid="next-episode"]',
    playlistClickSelector: '.episode-item, .drama-episode, .season-list a, .episode_list a',
    playlistClickLabel: 'MyVideo Episode Click'
  }),
  createSelectorAdapter({
    id: 'linetv',
    hostnames: ['linetv.tw'],
    videoSelector: '#line-player video, .player-container video, video.vjs-tech',
    playlistPathOrSearchCheck: (loc) => loc.pathname.toLowerCase().includes('/eps/'),
    playlistDomSelector: '.eps-item, .ep-btn, [data-testid="next-episode"], .episode_li, .eps_item',
    playlistClickSelector: '.eps-item, .ep-btn, [data-testid="next-episode"], .episode_li, .eps_item',
    playlistClickLabel: 'LINE TV Episode/Next Click'
  }),
  createSelectorAdapter({
    id: 'kktv',
    hostnames: ['kktv.me'],
    videoSelector: '.kktv-player video, .bitmovinplayer-container video, #player video',
    playlistDomSelector: '.play-series-item, .next-episode-btn, .series-item, [data-testid*="next-episode"]',
    playlistClickSelector: '.play-series-item, .next-episode-btn, .series-item, [data-testid*="next-episode"]',
    playlistClickLabel: 'KKTV Episode/Next Click'
  }),
  createSelectorAdapter({
    id: 'crunchyroll',
    hostnames: ['crunchyroll.com'],
    videoSelector: 'video#player0, #player0 video, .video-player video, #vilos video',
    playlistPathOrSearchCheck: (loc) => loc.pathname.toLowerCase().includes('/watch/'),
    playlistDomSelector: '[data-t="next-episode-btn"], .playable-card, [data-t="episode-card"], .next-episode-btn',
    playlistClickSelector: '[data-t="next-episode-btn"], .playable-card, [data-t="episode-card"], .next-episode-btn',
    playlistClickLabel: 'Crunchyroll Next/Episode Click'
  }),
  createSelectorAdapter({
    id: 'friday',
    hostnames: ['friday.tw'],
    videoSelector: '.player-container video, #player video, video.vjs-tech',
    playlistPathOrSearchCheck: (loc) => loc.search.includes('episode='),
    playlistDomSelector: '.episode-item, .drama-item, .item-episode, [data-episode]',
    playlistClickSelector: '.episode-item, .drama-item, .item-episode, [data-episode]',
    playlistClickLabel: 'friDay Episode Click'
  }),
  createSelectorAdapter({
    id: 'max',
    hostnames: ['max.com', 'hbomax.com'],
    videoSelector: '[data-testid="playerContainer"] video, [class*="VideoElement"] video',
    playlistPathOrSearchCheck: (loc) => {
      const p = loc.pathname.toLowerCase();
      return p.includes('/video/watch/') || p.includes('/player/');
    },
    playlistDomSelector:
      '[data-testid*="next-episode"], [data-testid*="up-next"], [aria-label*="Next Episode"], [aria-label*="下一集"]',
    playlistClickSelector:
      '[data-testid*="next-episode"], [data-testid*="up-next"], [aria-label*="Next Episode"], [aria-label*="下一集"]',
    playlistClickLabel: 'Max Next Episode Click'
  }),
  createSelectorAdapter({
    id: 'iqiyi',
    hostnames: ['iq.com', 'iqiyi.com'],
    videoSelector: '#iqpvid video, video[id*="iqp"], .iqp-player video, iq-player video',
    playlistDomSelector: '.album-item, .episode-item, .iqp-btn-next, [data-player-hook="next-btn"]',
    playlistClickSelector: '.album-item, .episode-item, .iqp-btn-next, [data-player-hook="next-btn"]',
    playlistClickLabel: 'iQIYI Episode/Next Click'
  }),
  createSelectorAdapter({
    id: 'appletv',
    hostnames: ['tv.apple.com'],
    videoSelector: 'amp-video-player video, apple-tv-plus-player video',
    playlistPathOrSearchCheck: (loc) => {
      const p = loc.pathname.toLowerCase();
      return p.includes('/episode/') || p.includes('umc.cmc.');
    },
    playlistDomSelector:
      '[data-testid*="next-episode"], .upstream-next-item, [aria-label*="Next Episode"], [aria-label*="下一集"]',
    playlistClickSelector:
      '[data-testid*="next-episode"], .upstream-next-item, [aria-label*="Next Episode"], [aria-label*="下一集"]',
    playlistClickLabel: 'Apple TV+ Next Episode Click'
  }),
  createSelectorAdapter({
    id: 'catchplay',
    hostnames: ['catchplay.com'],
    videoSelector: '.video-js video, video.vjs-tech, #player video, .player-container video',
    playlistPathOrSearchCheck: (loc) => loc.search.includes('ep=') || loc.search.includes('episode='),
    playlistDomSelector:
      '.episode-item, .next-episode, [class*="episode" i], [aria-label*="Next" i], [aria-label*="下一集"]',
    playlistClickSelector:
      '.episode-item, .next-episode, [class*="episode" i], [aria-label*="Next" i], [aria-label*="下一集"]',
    playlistClickLabel: 'CATCHPLAY+ Episode/Next Click'
  })
];

/**
 * 依據 hostname 解析對應之平台適配器（未命中特定網域則回傳 null 並降級使用通用方案）
 */
export function resolvePlatformAdapter(hostname: string = window.location.hostname): VideoPlatformAdapter | null {
  const cleanHost = hostname.toLowerCase();
  return PLATFORM_ADAPTERS.find((adapter) => adapter.hostnames.some((h) => cleanHost.includes(h))) || null;
}

export {
  findGenericVideoElement,
  ensureAnime1SourceReady,
  findAnime1Video,
  findNetflixVideo,
  findNiconicoVideo
};
export * from './types';
export * from './videoDomUtils';
