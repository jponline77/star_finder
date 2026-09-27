import { describe, expect, it } from 'vitest';
import { characterNames, creditLines, fileExtension, previewCredit, setPieces, songDocumentTitle, timeMessage, validateAudioFile, AUDIO_MAX_BYTES } from '../helpers';

describe('validateAudioFile', () => {
  const f = (name: string, size = 1000, type = '') => ({ name, size, type });

  it('accepts the STAR-friendly formats by extension or mime type', () => {
    for (const name of ['a.mp3', 'b.M4A', 'c.wav', 'd.aiff', 'e.aif', 'f.ogg', 'g.aac']) expect(validateAudioFile(f(name))).toBeNull();
    expect(validateAudioFile(f('track', 1000, 'audio/mpeg'))).toBeNull();
  });

  it('rejects empty, non-audio and too-big files with friendly messages', () => {
    expect(validateAudioFile(f('a.mp3', 0))).toMatch(/empty/);
    expect(validateAudioFile(f('notes.txt', 10, 'text/plain'))).toMatch(/doesn’t look like an audio file/);
    expect(validateAudioFile(f('clip.mov', 10, 'video/quicktime'))).toMatch(/audio file/);
    expect(validateAudioFile(f('big.wav', AUDIO_MAX_BYTES + 1, 'audio/wav'))).toMatch(/too big \(max 25 MB\)/);
    expect(validateAudioFile(f('ok.wav', AUDIO_MAX_BYTES, 'audio/wav'))).toBeNull();
  });

  it('fileExtension', () => {
    expect(fileExtension('My Song.Final.MP3')).toBe('mp3');
    expect(fileExtension('noext')).toBe('');
  });
});

describe('creditLines', () => {
  it('merges identical composer & lyricist (accent/case-insensitive)', () => {
    expect(creditLines({ composer: 'Anaïs Mitchell', lyricist: 'anais mitchell', bookWriter: 'Anaïs Mitchell' })).toEqual([{ role: 'Music & lyrics', names: 'Anaïs Mitchell' }]);
  });
  it('splits different writers and adds book on request', () => {
    expect(creditLines({ composer: 'Alan Menken', lyricist: 'Howard Ashman', bookWriter: 'Howard Ashman' }, { withBook: true })).toEqual([
      { role: 'Music', names: 'Alan Menken' },
      { role: 'Lyrics', names: 'Howard Ashman' },
      { role: 'Book', names: 'Howard Ashman' },
    ]);
  });
  it('handles unknowns', () => {
    expect(creditLines(null)).toEqual([]);
    expect(creditLines({ composer: null, lyricist: 'X', bookWriter: null })).toEqual([{ role: 'Lyrics', names: 'X' }]);
  });
});

describe('previewCredit', () => {
  it('names the recording and artist', () => {
    expect(previewCredit({ recordingName: 'Hadestown (Original Broadway Cast Recording)', recordingArtist: 'Eva Noblezada' })).toBe(
      'Preview courtesy of Apple Music — Hadestown (Original Broadway Cast Recording) · Eva Noblezada',
    );
    expect(previewCredit({ recordingName: null, recordingArtist: null })).toBe('Preview courtesy of Apple Music');
  });
});

describe('timeMessage', () => {
  it('fits / close / over / unknown', () => {
    expect(timeMessage(240)).toMatchObject({ status: 'ok', headline: 'Fits STAR’s 6:00 limit' });
    expect(timeMessage(240).detail).toContain('2:00 to spare');
    // the 6:00 clock starts after the slate — the copy must never suggest the slate uses up the spare time
    expect(timeMessage(240).detail).not.toMatch(/room for your slate/);
    expect(timeMessage(240).detail).toContain('the clock only starts after your slate');
    expect(timeMessage(345)).toMatchObject({ status: 'close' });
    expect(timeMessage(345).detail).toContain('0:15 to spare');
    const over = timeMessage(406);
    expect(over.status).toBe('over');
    expect(over.headline).toBe('Over STAR’s 6:00 limit — you’ll need a cut');
    expect(over.detail).toContain('0:46');
    expect(timeMessage(null).status).toBe('unknown');
    expect(timeMessage(360).status).toBe('close');
    expect(timeMessage(361).status).toBe('over');
  });
});

describe('small helpers', () => {
  it('setPieces follows the program guide', () => {
    expect(setPieces('solo')).toBe('up to 1 chair + 1 table');
    expect(setPieces('duet')).toBe('up to 2 chairs + 1 table');
  });
  it('characterNames', () => {
    expect(characterNames([{ character: 'Shrek' }, { character: 'Fiona' }])).toBe('Shrek & Fiona');
    expect(characterNames([{ character: 'Glinda' }])).toBe('Glinda');
  });
  it('songDocumentTitle', () => {
    expect(songDocumentTitle({ title: 'Popular', show: { name: 'Wicked' } })).toBe('Popular — Wicked');
    expect(songDocumentTitle(null)).toBeNull();
  });
});
