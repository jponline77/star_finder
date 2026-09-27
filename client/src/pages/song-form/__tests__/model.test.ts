import { describe, expect, it } from 'vitest';
import { makeSong, part } from '../../../test/fixtures';
import {
  EMPTY_NEW_SHOW,
  OTHER_GENRE,
  emptyValues,
  hasNewShowDetails,
  mapServerDetails,
  matchShow,
  newShowDetailsForName,
  orderedErrors,
  previewFromSong,
  shortenExtract,
  toSongInput,
  validateAudioFile,
  validateLength,
  validateSongForm,
  validateYear,
  valuesFromSong,
  withKind,
  type SongFormValues,
} from '../model';

const filled = (patch: Partial<SongFormValues> = {}): SongFormValues => ({
  ...emptyValues('solo'),
  title: 'Popular',
  showText: 'Wicked',
  showId: 1,
  parts: [{ character: 'Glinda', vocalRange: 'Soprano' }],
  ...patch,
});

describe('song form model', () => {
  it('switches solo ↔ duet keeping part 1 and restoring a stashed part 2', () => {
    const solo = filled();
    const duet = withKind(solo, 'duet');
    expect(duet.parts).toEqual([{ character: 'Glinda', vocalRange: 'Soprano' }, { character: '', vocalRange: '' }]);
    const back = withKind({ ...duet, parts: [duet.parts[0]!, { character: 'Elphaba', vocalRange: 'Mezzo-soprano' }] }, 'solo');
    expect(back.parts).toHaveLength(1);
    const again = withKind(back, 'duet', { character: 'Elphaba', vocalRange: 'Mezzo-soprano' });
    expect(again.parts[1]).toEqual({ character: 'Elphaba', vocalRange: 'Mezzo-soprano' });
  });

  it('validates required fields and limits like the server', () => {
    const errors = validateSongForm(emptyValues('duet'));
    expect(Object.keys(errors).sort()).toEqual(['parts.0.character', 'parts.1.character', 'show', 'title']);
    expect(validateSongForm(filled({ title: 'x'.repeat(121) })).title).toMatch(/120/);
    expect(validateSongForm(filled({ genreChoice: OTHER_GENRE, genreOther: '' })).genre).toMatch(/Type the genre/);
    expect(validateSongForm(filled({ audioLink: 'http://youtube.com/x' })).audioLink).toMatch(/https/);
    expect(validateSongForm(filled({ notes: 'n'.repeat(2001) })).notes).toMatch(/2000/);
    expect(validateSongForm(filled())).toEqual({});
  });

  it('rejects the same character twice in a duet', () => {
    const v = filled({ kind: 'duet', parts: [{ character: 'Glinda', vocalRange: '' }, { character: 'glinda ', vocalRange: '' }] });
    expect(validateSongForm(v)['parts.1.character']).toMatch(/two different/);
  });

  it('checks m:ss lengths', () => {
    expect(validateLength('')).toBeNull();
    expect(validateLength('3:25')).toBeNull();
    expect(validateLength('325')).toMatch(/m:ss|minutes:seconds/);
    expect(validateLength('3:75')).toMatch(/59/);
    expect(validateLength('0:00')).toMatch(/doesn’t look right/);
  });

  it('checks audio files and years', () => {
    expect(validateAudioFile(new File(['x'], 'demo.mp3', { type: 'audio/mpeg' }))).toBeNull();
    expect(validateAudioFile(new File(['x'], 'notes.pdf', { type: 'application/pdf' }))).toMatch(/MP3/);
    expect(validateYear('1987')).toBeNull();
    expect(validateYear('87')).toMatch(/4-digit/);
    expect(validateYear('2500')).toMatch(/between/);
  });

  it('builds the request body (showId vs showName, preview omitted/null/object)', () => {
    const v = filled({ length: '2:33', genreChoice: 'Comedy', subGenre: ' Satire ', notes: '  ', audioLink: '' });
    const body = toSongInput(v, { showId: 1 });
    expect(body).toEqual({
      kind: 'solo',
      title: 'Popular',
      showId: 1,
      genre: 'Comedy',
      subGenre: 'Satire',
      lengthSeconds: 153,
      mature: false,
      notes: null,
      parts: [{ character: 'Glinda', vocalRange: 'Soprano' }],
      audioLink: null,
    });
    expect('preview' in body).toBe(false);
    const byName = toSongInput({ ...v, showId: null, showText: ' Hadestown ' }, { showId: null, preview: null });
    expect(byName.showName).toBe('Hadestown');
    expect(byName.showId).toBeUndefined();
    expect(byName.preview).toBeNull();
  });

  it('pre-fills from a song (custom genre → Other…) and exposes its preview', () => {
    const song = makeSong({
      kind: 'duet',
      genre: 'Tragedy',
      lengthSeconds: 245,
      parts: [part('Romeo', 'Tenor', 1), part('Juliet', null, 2)],
      media: { previewUrl: 'https://audio-ssl.itunes.apple.com/p.m4a', artworkUrl: '/media/art/a.jpg', appleMusicUrl: null, recordingName: 'Cast', recordingArtist: 'Artist', audioUrl: null, audioLink: 'https://youtu.be/x' },
    });
    const v = valuesFromSong(song, ['Comedy', 'Drama', 'Romantic']);
    expect(v.genreChoice).toBe(OTHER_GENRE);
    expect(v.genreOther).toBe('Tragedy');
    expect(v.length).toBe('4:05');
    expect(v.parts).toEqual([{ character: 'Romeo', vocalRange: 'Tenor' }, { character: 'Juliet', vocalRange: '' }]);
    expect(v.audioLink).toBe('https://youtu.be/x');
    expect(previewFromSong(song)?.input.artworkUrl).toBe('/media/art/a.jpg');
  });

  it('maps server details onto form fields', () => {
    expect(mapServerDetails({ showName: 'bad', lengthSeconds: 'bad', 'preview.previewUrl': 'bad', 'parts.1.character': 'who?', existingId: '4', weird: 'x' })).toEqual({
      show: 'bad',
      length: 'bad',
      preview: 'bad',
      'parts.1.character': 'who?',
      _form: 'x',
    });
    expect(mapServerDetails({ name: 'dup', year: 'bad', imageUrl: 'nope' }, 'newShow.')).toEqual({ show: 'dup', 'newShow.year': 'bad', 'newShow.imageUrl': 'nope' });
  });

  it('orders errors by position on the page', () => {
    expect(orderedErrors({ notes: 'n', title: 't', show: 's' }).map(([k]) => k)).toEqual(['show', 'title', 'notes']);
  });

  it('matches shows loosely and decides when to create the show first', () => {
    const shows = [{ id: 1, name: 'Les Misérables' }];
    expect(matchShow('les miserables', shows)?.id).toBe(1);
    expect(matchShow('les mis', shows)).toBeNull();
    expect(hasNewShowDetails(EMPTY_NEW_SHOW)).toBe(false);
    expect(hasNewShowDetails({ ...EMPTY_NEW_SHOW, year: '1985' })).toBe(true);
    expect(hasNewShowDetails({ ...EMPTY_NEW_SHOW, imageUrl: 'https://upload.wikimedia.org/x.jpg', useImage: false })).toBe(false);
  });

  it('shortens a Wikipedia extract to ~3 sentences', () => {
    const text = 'One. Two! Three? Four. Five.';
    expect(shortenExtract(text)).toBe('One. Two! Three?');
    expect(shortenExtract('x'.repeat(900), 100)).toHaveLength(100);
  });
});

describe('newShowDetailsForName', () => {
  const fetched = {
    ...EMPTY_NEW_SHOW,
    composer: 'Typed Composer',
    description: 'Zeta extract.',
    wikiUrl: 'https://en.wikipedia.org/wiki/Zeta',
    wikiTitle: 'Zeta Alpha Show',
    imageUrl: 'https://upload.wikimedia.org/zeta.jpg',
    useImage: true,
    wikiFor: 'Zeta Alpha Show',
    wikiDescription: 'Zeta extract.',
  };
  it('keeps Wikipedia details for the same name (ignoring case/accents/spacing)', () => {
    expect(newShowDetailsForName(fetched, 'zeta alpha show')).toBe(fetched);
  });
  it('drops the Wikipedia link, poster and auto-filled description for a different name', () => {
    const next = newShowDetailsForName(fetched, 'Omega Beta Show');
    expect(next).toMatchObject({ wikiUrl: null, wikiTitle: null, imageUrl: null, description: '', wikiFor: null, composer: 'Typed Composer' });
    expect(hasNewShowDetails({ ...next, composer: '' })).toBe(false);
  });
  it('keeps a description the user edited themselves', () => {
    const next = newShowDetailsForName({ ...fetched, description: 'My own words.' }, 'Omega Beta Show');
    expect(next.description).toBe('My own words.');
    expect(next.wikiUrl).toBeNull();
  });
});
