/**
 * Recordings (Apple / iTunes candidates) → the song's 30-second preview + album art + length suggestion.
 * Pure helpers shared by the RecordingPicker, the song form and the song page (unit-tested in recordings.test.ts).
 */
import type { ItunesCandidate, Song, SongPreviewInput } from '../types';
import { APPLE_PREVIEW_CREDIT, type AudioTrack } from '../state/AudioProvider';

/** A chosen 30-second preview (from an iTunes candidate, or the song's current media). */
export interface ChosenPreview {
  input: SongPreviewInput;
  /** Track name shown in the UI. */
  trackName: string;
  durationSeconds: number | null;
  /** A cast recording of the show (from the catalog recordings' `castAlbum`). UI only — never sent to the API. */
  castAlbum?: boolean;
}

export function candidateToPreview(c: ItunesCandidate): ChosenPreview {
  return {
    castAlbum: c.castAlbum === true,
    input: {
      previewUrl: c.previewUrl,
      artworkUrl: c.artworkUrl,
      appleMusicUrl: c.appleMusicUrl,
      recordingName: c.collectionName || null,
      recordingArtist: c.artistName || null,
      itunesTrackId: c.trackId,
    },
    trackName: c.trackName,
    durationSeconds: c.durationSeconds,
  };
}

/**
 * The album art that came with the song's recording (also while an uploaded image is shown), or null. Uses the
 * server's `recordingArtworkUrl`; responses without it only know it when the art isn't an upload.
 */
export function recordingArtworkOf(song: Song): string | null {
  const m = song.media;
  if (m.recordingArtworkUrl !== undefined) return m.recordingArtworkUrl ?? null;
  return artworkSourceOf(song) === 'recording' ? m.artworkUrl : null;
}

/** The song's current iTunes preview as a ChosenPreview, or null. */
export function previewFromSong(song: Song): ChosenPreview | null {
  const m = song.media;
  if (!m.previewUrl) return null;
  return {
    input: {
      previewUrl: m.previewUrl,
      // the recording's own art (the server accepts the song's current recording art back as "keep it")
      artworkUrl: recordingArtworkOf(song),
      appleMusicUrl: m.appleMusicUrl,
      recordingName: m.recordingName,
      recordingArtist: m.recordingArtist,
      itunesTrackId: null,
    },
    trackName: song.title,
    durationSeconds: null,
  };
}

/**
 * Where a song's album art comes from. Responses from before SPEC §7c have no `artworkSource`: their art always
 * came with a recording (seed art or an Apple preview), so treat it as recording art.
 */
export function artworkSourceOf(song: Song): 'upload' | 'recording' | null {
  if (song.media.artworkSource !== undefined) return song.media.artworkSource ?? null;
  return song.media.artworkUrl ? 'recording' : null;
}

/**
 * The note under the length suggestion a chosen recording brings. Only a cast recording is "the cast recording";
 * a single, a concert or a search hit is just "this recording". (STAR's 6:00 limit is already shown by the length.)
 */
export function recordingLengthNote(preview: Pick<ChosenPreview, 'castAlbum'>): string {
  return preview.castAlbum
    ? 'That’s the length of the cast recording — your backing track and any cuts can change it.'
    : 'That’s this recording’s length — your version may differ.';
}

/** Is this candidate the chosen preview? (Songs don't expose their track id, so the preview URL counts too.) */
export function isChosenCandidate(chosen: ChosenPreview | null | undefined, c: ItunesCandidate): boolean {
  if (!chosen) return false;
  if (chosen.input.itunesTrackId !== null && chosen.input.itunesTrackId === c.trackId) return true;
  return Boolean(chosen.input.previewUrl && c.previewUrl && chosen.input.previewUrl === c.previewUrl);
}

export function scoreLabel(score: number): { text: string; tone: 'success' | 'gold' | 'outline' } {
  if (score >= 85) return { text: 'Great match', tone: 'success' };
  if (score >= 70) return { text: 'Likely match', tone: 'gold' };
  return { text: 'Maybe', tone: 'outline' };
}

/** A playable track for the shared mini player, or null when there's no preview. */
export function candidateTrack(c: Pick<ItunesCandidate, 'trackId' | 'previewUrl' | 'trackName' | 'collectionName' | 'artworkUrl'>): AudioTrack | null {
  if (!c.previewUrl) return null;
  return {
    key: `itunes:${c.trackId}`,
    src: c.previewUrl,
    title: c.trackName,
    subtitle: c.collectionName || undefined,
    artworkUrl: c.artworkUrl,
    artworkSeed: c.collectionName || c.trackName,
    credit: APPLE_PREVIEW_CREDIT,
  };
}

export function chosenTrack(chosen: ChosenPreview): AudioTrack | null {
  if (!chosen.input.previewUrl) return null;
  return {
    key: `chosen:${chosen.input.itunesTrackId ?? chosen.input.previewUrl}`,
    src: chosen.input.previewUrl,
    title: chosen.trackName,
    subtitle: chosen.input.recordingName ?? undefined,
    artworkUrl: chosen.input.artworkUrl,
    artworkSeed: chosen.input.recordingName ?? chosen.trackName,
    credit: APPLE_PREVIEW_CREDIT,
  };
}
