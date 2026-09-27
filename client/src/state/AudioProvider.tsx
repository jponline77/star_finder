/**
 * One shared <audio> for the whole app — only one preview plays at a time.
 *
 *   const audio = useAudio();
 *   audio.play(song);                 // plays media.previewUrl, else media.audioUrl
 *   audio.play(song, 'upload');       // force the uploaded file
 *   audio.play(candidateTrack);       // any AudioTrack (e.g. an iTunes candidate in the song form)
 *   audio.toggle(song); audio.stop(); audio.isPlaying(song);
 *   const { currentTime, duration } = useAudioProgress();   // re-renders ~4×/s while playing
 *
 * Errors show a toast. The bottom <MiniPlayer/> (rendered by Layout) displays the current track.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Song } from '../types';
import { useToast } from './ToastProvider';

export interface AudioTrack {
  /** Unique key: `song:<id>`, `upload:<id>`, `itunes:<trackId>`… */
  key: string;
  src: string;
  title: string;
  /** e.g. the show name */
  subtitle?: string;
  artworkUrl?: string | null;
  /** Seed for the gradient fallback artwork (defaults to subtitle/title). */
  artworkSeed?: string;
  /** When set, the mini player links the title to /songs/:songId */
  songId?: number;
  /** Attribution line shown in the mini player (e.g. "Preview courtesy of Apple Music"). */
  credit?: string;
}

export const APPLE_PREVIEW_CREDIT = 'Preview courtesy of Apple Music';

export type AudioSource = 'auto' | 'preview' | 'upload';
export type AudioStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

/** Build a track for a song, or null when it has nothing playable. */
export function songTrack(song: Song, source: AudioSource = 'auto'): AudioTrack | null {
  const preview = song.media.previewUrl;
  const uploaded = song.media.audioUrl;
  const base = {
    title: song.title,
    subtitle: song.show.name,
    artworkUrl: song.media.artworkUrl ?? song.show.imageUrl,
    artworkSeed: song.show.name,
    songId: song.id,
  };
  if ((source === 'auto' || source === 'preview') && preview)
    return { ...base, key: `song:${song.id}`, src: preview, credit: APPLE_PREVIEW_CREDIT };
  if ((source === 'auto' || source === 'upload') && uploaded)
    return { ...base, key: `upload:${song.id}`, src: uploaded, credit: 'Audio shared by the community' };
  return null;
}

function isSong(item: Song | AudioTrack): item is Song {
  return (item as Song).media !== undefined && (item as Song).kind !== undefined;
}

export interface AudioContextValue {
  current: AudioTrack | null;
  status: AudioStatus;
  /** status === 'playing' || status === 'loading' */
  playing: boolean;
  /** Start (or restart) playback. Returns false when nothing playable. */
  play: (item: Song | AudioTrack, source?: AudioSource) => boolean;
  /** Toggle: if `item` is current → pause/resume; otherwise play it. No arg → current. */
  toggle: (item?: Song | AudioTrack, source?: AudioSource) => void;
  pause: () => void;
  resume: () => void;
  /** Stop and hide the mini player. */
  stop: () => void;
  seek: (seconds: number) => void;
  /** Is this song/track/key the current one (playing or paused)? */
  isCurrent: (item: Song | AudioTrack | string) => boolean;
  /** Is this song/track/key currently playing (or loading)? */
  isPlaying: (item: Song | AudioTrack | string) => boolean;
  /** Does this song have something playable? */
  canPlay: (song: Song, source?: AudioSource) => boolean;
  /**
   * The control that started the current track, if it's still on the page — where keyboard focus
   * should go back to when the mini player closes (the player's own buttons unmount with it).
   */
  returnFocusTarget: () => HTMLElement | null;
}

const AudioContext = createContext<AudioContextValue | null>(null);

// ---- progress store (kept outside React state so only subscribers re-render) ----
interface Progress {
  currentTime: number;
  duration: number;
}
const ZERO: Progress = { currentTime: 0, duration: 0 };
let progress: Progress = ZERO;
const progressListeners = new Set<() => void>();
function setProgress(next: Progress) {
  if (next.currentTime === progress.currentTime && next.duration === progress.duration) return;
  progress = next;
  progressListeners.forEach((l) => l());
}
function subscribeProgress(l: () => void) {
  progressListeners.add(l);
  return () => progressListeners.delete(l);
}

/** { currentTime, duration } of the shared player (seconds). */
export function useAudioProgress(): Progress {
  return useSyncExternalStore(subscribeProgress, () => progress, () => ZERO);
}

function keyOf(item: Song | AudioTrack | string, source: AudioSource = 'auto'): string | null {
  if (typeof item === 'string') return item;
  if (isSong(item)) return songTrack(item, source)?.key ?? null;
  return item.key;
}

export function AudioProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [current, setCurrent] = useState<AudioTrack | null>(null);
  const [status, setStatus] = useState<AudioStatus>('idle');
  const currentRef = useRef<AudioTrack | null>(null);
  /**
   * True once the current source failed to load or start. A media element stays in its error
   * state until load() runs again, so play() alone would never re-request the file.
   */
  const failedRef = useRef(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  const getAudio = useCallback((): HTMLAudioElement | null => {
    if (audioRef.current) return audioRef.current;
    if (typeof Audio === 'undefined') return null;
    const el = new Audio();
    el.preload = 'none';
    audioRef.current = el;
    return el;
  }, []);

  // wire element events once
  useEffect(() => {
    const el = getAudio();
    if (!el) return;
    const update = () => setProgress({ currentTime: el.currentTime || 0, duration: Number.isFinite(el.duration) ? el.duration : 0 });
    const onPlaying = () => setStatus('playing');
    const onPause = () => setStatus((s) => (s === 'idle' || s === 'error' ? s : 'paused'));
    const onWaiting = () => setStatus('loading');
    const onEnded = () => {
      setStatus('paused');
      setProgress({ currentTime: 0, duration: Number.isFinite(el.duration) ? el.duration : 0 });
    };
    const onError = () => {
      if (!currentRef.current || !el.getAttribute('src')) return;
      failedRef.current = true;
      setStatus('error');
      toast.error("Couldn't play that preview — the link may have expired. Try another song!", { id: 'audio-error', emoji: '🔇' });
    };
    el.addEventListener('timeupdate', update);
    el.addEventListener('durationchange', update);
    el.addEventListener('loadedmetadata', update);
    el.addEventListener('playing', onPlaying);
    el.addEventListener('pause', onPause);
    el.addEventListener('waiting', onWaiting);
    el.addEventListener('ended', onEnded);
    el.addEventListener('error', onError);
    return () => {
      el.removeEventListener('timeupdate', update);
      el.removeEventListener('durationchange', update);
      el.removeEventListener('loadedmetadata', update);
      el.removeEventListener('playing', onPlaying);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('waiting', onWaiting);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('error', onError);
      if (!el.paused) el.pause();
    };
  }, [getAudio, toast]);

  const startPlayback = useCallback(
    (el: HTMLAudioElement) => {
      if (failedRef.current || el.error) {
        // Retry after a failure (Wi-Fi blip, expired link): reset the element and fetch again.
        failedRef.current = false;
        try {
          el.load();
        } catch {
          /* jsdom */
        }
      }
      let result: Promise<void> | undefined;
      try {
        result = el.play();
      } catch {
        result = undefined;
      }
      if (result && typeof result.catch === 'function') {
        result.catch((e: unknown) => {
          if (e instanceof DOMException && e.name === 'AbortError') return; // superseded by another play()
          failedRef.current = true;
          setStatus('error');
          toast.error("Couldn't start playback. Tap play to try again.", { id: 'audio-error', emoji: '🔇' });
        });
      }
    },
    [toast],
  );

  const play = useCallback(
    (item: Song | AudioTrack, source: AudioSource = 'auto') => {
      const track = isSong(item) ? songTrack(item, source) : item;
      if (!track) {
        toast.info('No preview for this one yet — maybe you can add one!', { id: 'no-preview', emoji: '🎧' });
        return false;
      }
      const el = getAudio();
      if (!el) return false;
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      if (active instanceof HTMLElement && active !== document.body && !active.closest('.mini-player')) triggerRef.current = active;
      currentRef.current = track;
      setCurrent(track);
      setStatus('loading');
      setProgress(ZERO);
      if (el.getAttribute('src') !== track.src) {
        failedRef.current = false; // assigning src runs the load algorithm (clears any error)
        el.src = track.src;
      } else {
        el.currentTime = 0;
      }
      startPlayback(el);
      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator && typeof MediaMetadata !== 'undefined') {
        try {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: track.title,
            artist: track.subtitle ?? 'STAR Song Finder',
            artwork: track.artworkUrl ? [{ src: track.artworkUrl, sizes: '600x600' }] : [],
          });
        } catch {
          /* ignore */
        }
      }
      return true;
    },
    [getAudio, startPlayback, toast],
  );

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setStatus((s) => (s === 'idle' ? s : 'paused'));
  }, []);

  const resume = useCallback(() => {
    const el = audioRef.current;
    if (!el || !currentRef.current) return;
    setStatus('loading');
    startPlayback(el);
  }, [startPlayback]);

  const stop = useCallback(() => {
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute('src');
      failedRef.current = false;
      try {
        el.load();
      } catch {
        /* jsdom */
      }
    }
    currentRef.current = null;
    setCurrent(null);
    setStatus('idle');
    setProgress(ZERO);
  }, []);

  const seek = useCallback((seconds: number) => {
    const el = audioRef.current;
    if (!el || !Number.isFinite(seconds)) return;
    el.currentTime = Math.max(0, seconds);
    setProgress({ currentTime: el.currentTime, duration: Number.isFinite(el.duration) ? el.duration : 0 });
  }, []);

  const isCurrent = useCallback(
    (item: Song | AudioTrack | string) => {
      if (!current) return false;
      if (typeof item !== 'string' && isSong(item)) return current.songId === item.id;
      return keyOf(item) === current.key;
    },
    [current],
  );

  const isPlaying = useCallback(
    (item: Song | AudioTrack | string) => isCurrent(item) && (status === 'playing' || status === 'loading'),
    [isCurrent, status],
  );

  const toggle = useCallback(
    (item?: Song | AudioTrack, source: AudioSource = 'auto') => {
      const cur = currentRef.current;
      const sameAsCurrent =
        !item ||
        (cur !== null && (isSong(item) ? (source === 'auto' ? cur.songId === item.id : keyOf(item, source) === cur.key) : item.key === cur.key));
      if (sameAsCurrent && cur) {
        if (status === 'playing' || status === 'loading') pause();
        else resume();
        return;
      }
      if (item) play(item, source);
    },
    [pause, play, resume, status],
  );

  const canPlay = useCallback((song: Song, source: AudioSource = 'auto') => songTrack(song, source) !== null, []);

  const returnFocusTarget = useCallback(() => {
    const el = triggerRef.current;
    return el && el.isConnected ? el : null;
  }, []);

  const value = useMemo<AudioContextValue>(
    () => ({
      current,
      status,
      playing: status === 'playing' || status === 'loading',
      play,
      toggle,
      pause,
      resume,
      stop,
      seek,
      isCurrent,
      isPlaying,
      canPlay,
      returnFocusTarget,
    }),
    [current, status, play, toggle, pause, resume, stop, seek, isCurrent, isPlaying, canPlay, returnFocusTarget],
  );

  return <AudioContext.Provider value={value}>{children}</AudioContext.Provider>;
}

export function useAudio(): AudioContextValue {
  const ctx = useContext(AudioContext);
  if (!ctx) throw new Error('useAudio must be used inside <AudioProvider>');
  return ctx;
}
