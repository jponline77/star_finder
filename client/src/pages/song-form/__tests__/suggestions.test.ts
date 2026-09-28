import { describe, expect, it } from 'vitest';
import { GENRES } from '../../../lib/vocab';
import { catalogShowLesMis, catalogShowWicked, suggestionsBringHimHome, suggestionsLittleFallOfRain, suggestionsOneDayMore, suggestionsWizardAndI } from '../../../test/catalogFixtures';
import { OTHER_GENRE } from '../model';
import { genreFields, prefillFromCatalogShow, prefillFromSuggestions, showMatchesCatalog, withoutCatalogCredits } from '../suggestions';

const genres = [...GENRES];

describe('prefillFromSuggestions', () => {
  it('fills a solo on a show that is already on the site, with a chip per field', () => {
    const { values, isNewShow, suggestions } = prefillFromSuggestions(suggestionsBringHimHome(), { genres });
    expect(values).toMatchObject({
      kind: 'solo',
      title: 'Bring Him Home',
      showId: 14,
      showText: 'Les Misérables',
      genreChoice: 'Drama',
      subGenre: 'Longing',
      mature: false,
      parts: [{ character: 'Jean Valjean', vocalRange: 'Tenor' }],
    });
    expect(isNewShow).toBe(false);
    expect(suggestions.catalogSongId).toBe(22);
    expect(suggestions.existing).toEqual({ id: 99, title: 'Bring Him Home', kind: 'solo' });
    expect(suggestions.kind).toMatchObject({ value: 'solo', confidence: 'high' });
    expect(suggestions.kindNote).toBeNull();
    expect(suggestions.genre).toMatchObject({ value: 'Drama', alternatives: ['Romantic'] });
    expect(suggestions.ranges.get('jean valjean')).toMatchObject({ value: 'Tenor', source: 'from 3 other Les Misérables songs on the site', confidence: 'high' });
    expect(suggestions.characters[1]).toBeNull();
  });

  it('fills both parts of a duet and knows ranges by the catalog’s spelling too', () => {
    const { values, suggestions } = prefillFromSuggestions(suggestionsLittleFallOfRain(), { genres });
    expect(values.kind).toBe('duet');
    expect(values.parts).toEqual([
      { character: 'Éponine', vocalRange: 'Mezzo-soprano' },
      { character: 'Marius Pontmercy', vocalRange: 'Tenor' },
    ]);
    // "Marius" is the catalog's spelling of the same person (catalogName) — never offered as a second character
    expect(suggestions.characters[0]).toMatchObject({ value: 'Éponine', alternatives: ['Marius Pontmercy'] });
    expect(suggestions.characters[1]).toMatchObject({ value: 'Marius Pontmercy', alternatives: ['Éponine'] });
    expect(suggestions.ranges.get('marius')).toMatchObject({ value: 'Tenor', confidence: 'medium' });
  });

  it('never offers the same person twice when the site spells a character differently (Marius / Marius Pontmercy)', () => {
    const s = {
      ...suggestionsLittleFallOfRain(),
      catalogSong: { id: 15, title: 'Valjean’s Confession', act: 2, singers: ['Jean Valjean', 'Marius Pontmercy'], singersRaw: '', ensemble: false, reprise: false },
      parts: {
        value: [
          { character: 'Jean Valjean', vocalRange: 'Tenor' },
          { character: 'Marius', catalogName: 'Marius Pontmercy', vocalRange: 'Tenor' },
        ],
        source: 'from the Wikipedia song list',
        confidence: 'high' as const,
      },
    };
    const { values, suggestions } = prefillFromSuggestions(s, { genres });
    expect(values.parts.map((p) => p.character)).toEqual(['Jean Valjean', 'Marius']);
    expect(suggestions.characters[0]?.alternatives).toEqual(['Marius']);
    expect(suggestions.characters[1]?.alternatives).toEqual(['Jean Valjean']);
    // the banner still shows the song list as written
    expect(suggestions.song.singers).toEqual(['Jean Valjean', 'Marius Pontmercy']);
  });

  it('keeps every site version of the song (existingSongs) and where the song came from', () => {
    const solo = { id: 99, title: 'Bring Him Home', kind: 'solo' as const };
    const duet = { id: 100, title: 'Bring Him Home', kind: 'duet' as const };
    const both = prefillFromSuggestions({ ...suggestionsBringHimHome(), existingSongs: [solo, duet] }, { genres }).suggestions;
    expect(both.existing).toEqual(solo);
    expect(both.existingAll).toEqual([solo, duet]);
    expect(both.song.source).toBe('wikipedia');
    // older answers: only existingSong
    expect(prefillFromSuggestions(suggestionsBringHimHome(), { genres }).suggestions.existingAll).toEqual([solo]);
    expect(prefillFromSuggestions({ ...suggestionsBringHimHome(), existingSong: null }, { genres }).suggestions.existingAll).toEqual([]);
    const fromAlbum = { ...suggestionsBringHimHome(), catalogSong: { ...suggestionsBringHimHome().catalogSong, source: 'recording' as const } };
    expect(prefillFromSuggestions(fromAlbum, { genres }).suggestions.song.source).toBe('recording');
  });

  it('a two-singer duet guess offers Solo as a one-tap alternative, with the server’s note', () => {
    const s = suggestionsWizardAndI();
    const duet = {
      ...s,
      catalogSong: { ...s.catalogSong, singers: ['Madame Morrible', 'Elphaba'], singersRaw: 'Madame Morrible and Elphaba' },
      kind: {
        value: 'duet' as const,
        source: 'from the Wikipedia song list (sung by Madame Morrible and Elphaba)',
        confidence: 'medium' as const,
        alternatives: ['solo' as const, 'duet' as const],
        note: 'If one of them only sings a line or two, it’s really a solo.',
      },
    };
    const { values, suggestions } = prefillFromSuggestions(duet, { genres });
    expect(values.kind).toBe('duet');
    expect(suggestions.kind).toMatchObject({ value: 'duet', confidence: 'medium', alternatives: ['solo'], note: 'If one of them only sings a line or two, it’s really a solo.' });
    // no alternatives from the server → none offered
    expect(prefillFromSuggestions(suggestionsLittleFallOfRain(), { genres }).suggestions.kind?.alternatives).toEqual([]);
  });

  it('group numbers: no kind guess, a note, the ?kind= from the link, and every singer as a choice', () => {
    const { values, suggestions } = prefillFromSuggestions(suggestionsOneDayMore(), { genres, kind: 'duet' });
    expect(suggestions.kind).toBeNull();
    expect(suggestions.kindNote).toMatch(/ensemble number/);
    expect(values.kind).toBe('duet');
    expect(values.parts.map((p) => p.character)).toEqual(['Jean Valjean', 'Marius']);
    expect(suggestions.characters[0]?.note).toMatch(/first character for a solo/);
    expect(suggestions.characters[1]?.alternatives).toEqual(['Jean Valjean', 'Cosette', 'Éponine']);
    // without a ?kind= a group number starts as a solo
    expect(prefillFromSuggestions(suggestionsOneDayMore(), { genres }).values.kind).toBe('solo');
  });

  it('a show that is not on the site yet: typed in as a new show with the catalog credits', () => {
    const { values, isNewShow, newShow, suggestions } = prefillFromSuggestions(suggestionsWizardAndI(), { genres });
    expect(values).toMatchObject({ showId: null, showText: 'Wicked', genreChoice: OTHER_GENRE, genreOther: 'Tragicomedy' });
    expect(isNewShow).toBe(true);
    expect(newShow).toMatchObject({ composer: 'Stephen Schwartz', lyricist: 'Stephen Schwartz', year: '2003' });
    expect(suggestions.show).toMatchObject({ catalogShowId: 3, siteShowId: null, bookWriter: 'Winnie Holzman' });
  });

  it('accepts a kind with a null value (the other way the server can say "no guess")', () => {
    const s = { ...suggestionsOneDayMore(), kind: { value: null, source: 'x', confidence: 'low' as const, note: 'Group number — pick one.' }, kindNote: undefined };
    const { suggestions } = prefillFromSuggestions(s, { genres });
    expect(suggestions.kind).toBeNull();
    expect(suggestions.kindNote).toBe('Group number — pick one.');
  });
});

describe('show helpers', () => {
  it('maps genres case-insensitively, else "Other…"', () => {
    expect(genreFields('comedy', genres)).toEqual({ genreChoice: 'Comedy', genreOther: '' });
    expect(genreFields('Operetta', genres)).toEqual({ genreChoice: OTHER_GENRE, genreOther: 'Operetta' });
    expect(genreFields('', genres)).toEqual({ genreChoice: '', genreOther: '' });
  });

  it('knows whether the form still points at the catalog show', () => {
    const { suggestions } = prefillFromSuggestions(suggestionsWizardAndI(), { genres });
    expect(showMatchesCatalog(suggestions.show, { showId: null, showText: 'wicked' }, null)).toBe(true);
    expect(showMatchesCatalog(suggestions.show, { showId: 5, showText: 'Hadestown' }, 'Hadestown')).toBe(false);
    const site = prefillFromSuggestions(suggestionsBringHimHome(), { genres }).suggestions.show;
    expect(showMatchesCatalog(site, { showId: 14, showText: 'x' }, 'Les Misérables')).toBe(true);
  });

  it('drops catalog credits the student didn’t change when the show changes', () => {
    const { newShow, suggestions } = prefillFromSuggestions(suggestionsWizardAndI(), { genres });
    expect(withoutCatalogCredits({ ...newShow, lyricist: 'Someone Else' }, suggestions.show)).toMatchObject({ composer: '', lyricist: 'Someone Else', year: '' });
  });

  it('"My song isn’t listed" on a catalog show', () => {
    const wicked = prefillFromCatalogShow(catalogShowWicked, 'duet');
    expect(wicked.values).toMatchObject({ kind: 'duet', showId: null, showText: 'Wicked' });
    expect(wicked.isNewShow).toBe(true);
    expect(wicked.newShow.composer).toBe('Stephen Schwartz');
    const lesMis = prefillFromCatalogShow(catalogShowLesMis, null);
    expect(lesMis.values).toMatchObject({ kind: 'solo', showId: 14 });
    expect(lesMis.isNewShow).toBe(false);
  });
});
