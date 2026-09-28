import { describe, expect, it } from 'vitest';
import { IMAGE_MAX_BYTES, objectUrlFor, revokeObjectUrl, validateAudioFile, validateImageFile } from './media';
import { artworkSourceOf, candidateToPreview, isChosenCandidate, previewFromSong, recordingArtworkOf, recordingLengthNote } from './recordings';
import { makeSong } from '../test/fixtures';
import type { ItunesCandidate } from '../types';

const f = (name: string, type: string, size = 1000) => ({ name, type, size });

describe('validateImageFile (album art: jpeg/png/webp/gif ≤ 5 MB)', () => {
  it('accepts the four formats, by type or (when the type is missing) by extension', () => {
    expect(validateImageFile(f('cover.jpg', 'image/jpeg'))).toBeNull();
    expect(validateImageFile(f('cover.PNG', 'image/png'))).toBeNull();
    expect(validateImageFile(f('cover.webp', 'image/webp'))).toBeNull();
    expect(validateImageFile(f('cover.gif', 'image/gif'))).toBeNull();
    expect(validateImageFile(f('cover.jpeg', ''))).toBeNull();
    expect(validateImageFile(f('cover.jpg', 'application/octet-stream'))).toBeNull();
  });

  it('refuses SVG, HEIC, other files, empty and too-big images with friendly words', () => {
    expect(validateImageFile(f('logo.svg', 'image/svg+xml'))).toMatch(/SVG/);
    expect(validateImageFile(f('IMG_1234.HEIC', 'image/heic'))).toMatch(/HEIC/);
    expect(validateImageFile(f('notes.txt', 'text/plain'))).toMatch(/doesn’t look like a picture/);
    expect(validateImageFile(f('scan.bmp', 'image/bmp'))).toMatch(/JPG, PNG, WebP or GIF/);
    expect(validateImageFile(f('cover.jpg', 'image/jpeg', 0))).toMatch(/empty/);
    expect(validateImageFile(f('huge.jpg', 'image/jpeg', IMAGE_MAX_BYTES + 1))).toMatch(/limit is 5 MB/);
  });
});

describe('validateAudioFile (backing tracks ≤ 25 MB)', () => {
  it('accepts audio and refuses the rest', () => {
    expect(validateAudioFile(f('track.mp3', 'audio/mpeg'))).toBeNull();
    expect(validateAudioFile(f('track.m4a', ''))).toBeNull();
    expect(validateAudioFile(f('clip.mp4', 'video/mp4'))).toBeNull(); // m4a-in-mp4 is fine; the server sniffs
    expect(validateAudioFile(f('notes.txt', 'text/plain'))).toMatch(/audio file/);
    expect(validateAudioFile(f('big.wav', 'audio/wav', 26 * 1024 * 1024))).toMatch(/too big/);
  });
});

describe('objectUrlFor', () => {
  it('makes a local preview URL for a file, and never throws', () => {
    const url = objectUrlFor(new Blob(['x']));
    expect(url === null || url.startsWith('blob:')).toBe(true);
    revokeObjectUrl(url);
    expect(objectUrlFor(null)).toBeNull();
    const original = URL.createObjectURL;
    try {
      Object.defineProperty(URL, 'createObjectURL', { value: undefined, configurable: true, writable: true });
      expect(objectUrlFor(new Blob(['x']))).toBeNull();
    } finally {
      Object.defineProperty(URL, 'createObjectURL', { value: original, configurable: true, writable: true });
    }
  });
});

describe('recordings helpers', () => {
  const cand: ItunesCandidate = {
    trackId: 5,
    trackName: 'Stars',
    collectionName: 'Les Misérables (OLC)',
    artistName: 'Roger Allam',
    previewUrl: 'https://audio-ssl.itunes.apple.com/p.m4a',
    artworkUrl: 'https://is1-ssl.mzstatic.com/a.jpg',
    appleMusicUrl: null,
    durationSeconds: 190,
    score: 90,
  };

  it('turns a candidate into a preview and recognises it again by track id or preview URL', () => {
    const p = candidateToPreview(cand);
    expect(p.input).toMatchObject({ itunesTrackId: 5, recordingName: 'Les Misérables (OLC)', recordingArtist: 'Roger Allam' });
    expect(isChosenCandidate(p, cand)).toBe(true);
    expect(isChosenCandidate({ ...p, input: { ...p.input, itunesTrackId: null } }, cand)).toBe(true);
    expect(isChosenCandidate(null, cand)).toBe(false);
  });

  it('only calls a length "the cast recording’s" when the recording is one (and never sends that flag to the API)', () => {
    const cast = candidateToPreview({ ...cand, castAlbum: true, albumLabel: 'original cast recording' });
    const single = candidateToPreview({ ...cand, collectionName: 'Tomorrow - Single', castAlbum: false, albumLabel: null });
    const searched = candidateToPreview(cand); // /api/lookup/itunes answers don't say
    expect(cast.castAlbum).toBe(true);
    expect(single.castAlbum).toBe(false);
    expect(searched.castAlbum).toBe(false);
    expect(recordingLengthNote(cast)).toMatch(/length of the cast recording/);
    expect(recordingLengthNote(single)).toBe('That’s this recording’s length — your version may differ.');
    expect(recordingLengthNote(searched)).not.toMatch(/cast/);
    for (const note of [recordingLengthNote(cast), recordingLengthNote(single)]) expect(note).not.toMatch(/6:00/); // the length field already says it
    expect(cast.input).not.toHaveProperty('castAlbum');
  });

  it('knows where a song’s art comes from (old responses count as recording art)', () => {
    const media = makeSong().media;
    expect(artworkSourceOf(makeSong({ media: { ...media, artworkUrl: '/media/art/a.jpg' } }))).toBe('recording');
    expect(artworkSourceOf(makeSong({ media: { ...media, artworkUrl: '/uploads/art/u.jpg', artworkSource: 'upload' } }))).toBe('upload');
    expect(artworkSourceOf(makeSong())).toBeNull();
    // an uploaded image is not the recording's art
    const withUpload = makeSong({ media: { ...media, previewUrl: 'https://audio-ssl.itunes.apple.com/p.m4a', artworkUrl: '/uploads/art/u.jpg', artworkSource: 'upload' } });
    expect(previewFromSong(withUpload)?.input.artworkUrl).toBeNull();
    expect(recordingArtworkOf(withUpload)).toBeNull();
    // …but the server's recordingArtworkUrl says what the recording's own art is
    const both = makeSong({ media: { ...withUpload.media, recordingArtworkUrl: '/uploads/art/rec.jpg' } });
    expect(recordingArtworkOf(both)).toBe('/uploads/art/rec.jpg');
    expect(previewFromSong(both)?.input.artworkUrl).toBe('/uploads/art/rec.jpg');
    expect(recordingArtworkOf(makeSong({ media: { ...media, artworkUrl: '/media/art/a.jpg' } }))).toBe('/media/art/a.jpg');
  });
});
