import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { clearCatalogCaches } from '../../hooks/useCatalog';
import type { ChosenPreview } from '../../lib/recordings';
import { json, mockFetch } from '../../pages/__tests__/mockFetch';
import { candidate } from '../../test/catalogFixtures';
import { renderWithProviders } from '../../test/render';
import { RecordingPicker, type ChooseHow } from '../RecordingPicker';

afterEach(() => {
  vi.unstubAllGlobals();
  clearCatalogCaches();
});

const three = [
  candidate({ trackId: 1, collectionName: 'Les Misérables (Original Broadway Cast Recording)', durationSeconds: 201 }),
  candidate({ trackId: 2, collectionName: 'Les Misérables (Original London Cast Recording)', artistName: 'Colm Wilkinson', durationSeconds: 214 }),
  candidate({ trackId: 3, collectionName: 'Broadway Belters', previewUrl: null }),
];

function Harness(props: { catalogSongId: number | null; autoSelect?: boolean; autoLoad?: boolean; onChoose?: (p: ChosenPreview | null, how: ChooseHow) => void }) {
  const [chosen, setChosen] = useState<ChosenPreview | null>(null);
  return (
    <>
      <RecordingPicker
        catalogSongId={props.catalogSongId}
        title="Bring Him Home"
        showName="Les Misérables"
        chosen={chosen}
        autoLoad={props.autoLoad}
        autoSelect={props.autoSelect}
        onChoose={(p, how) => {
          setChosen(p);
          props.onChoose?.(p, how);
        }}
      />
      <p data-testid="chosen-name">{chosen ? `${chosen.input.recordingName} ${chosen.durationSeconds}` : 'none'}</p>
    </>
  );
}

describe('RecordingPicker', () => {
  it('catalog songs: loads by itself, auto-selects the best playable match, and a tap picks another', async () => {
    const api = mockFetch({ 'GET /api/catalog/songs/22/recordings': () => json(200, { candidates: three }) });
    const onChoose = vi.fn();
    renderWithProviders(<Harness catalogSongId={22} autoLoad autoSelect onChoose={onChoose} />);
    expect(await screen.findByTestId('chosen-preview')).toHaveTextContent('Best match — picked for you');
    expect(onChoose).toHaveBeenLastCalledWith(expect.objectContaining({ durationSeconds: 201 }), 'auto');
    expect(api.calls('GET /api/catalog/songs/22/recordings')).toHaveLength(1);
    // only playable recordings are offered, plus "No recording"
    const cards = screen.getAllByTestId('preview-candidate');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('Best match');
    expect(cards[0]).toHaveTextContent('3:21');
    expect(screen.getByTestId('use-preview-0')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('2 recordings');

    fireEvent.click(screen.getByTestId('use-preview-1'));
    expect(onChoose).toHaveBeenLastCalledWith(expect.objectContaining({ durationSeconds: 214 }), 'user');
    expect(screen.getByTestId('chosen-name')).toHaveTextContent('Les Misérables (Original London Cast Recording) 214');
    expect(screen.getByTestId('chosen-preview')).toHaveTextContent('Recording chosen');
    expect(screen.getByTestId('use-preview-1')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('use-preview-0')).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByTestId('no-recording'));
    expect(onChoose).toHaveBeenLastCalledWith(null, 'user');
    expect(screen.queryByTestId('chosen-preview')).toBeNull();
    expect(screen.getByTestId('no-recording')).toHaveAttribute('aria-pressed', 'true');
  });

  it('Apple busy for the whole site (503 + Retry-After): says how long, then a background load tries once more by itself', async () => {
    let busy = true;
    const api = mockFetch({
      'GET /api/catalog/songs/22/recordings': () =>
        busy
          ? new Response(JSON.stringify({ error: 'Apple Music lookups are busy right now' }), { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '1' } })
          : json(200, { candidates: three }),
    });
    renderWithProviders(<Harness catalogSongId={22} autoLoad autoSelect />);
    expect(await screen.findByTestId('recordings-error')).toHaveTextContent('Apple Music is busy with other look-ups right now — try again in a few seconds.');
    expect(screen.getByTestId('recordings-error')).not.toHaveAttribute('role'); // a background load doesn't interrupt
    busy = false;
    expect(await screen.findByTestId('chosen-preview', {}, { timeout: 4000 })).toHaveTextContent('Best match — picked for you');
    expect(api.calls('GET /api/catalog/songs/22/recordings')).toHaveLength(2);
  });

  it('title search: waits for the student, never auto-picks', async () => {
    const api = mockFetch({ 'GET /api/lookup/itunes': () => json(200, { candidates: three }) });
    const onChoose = vi.fn();
    renderWithProviders(<Harness catalogSongId={null} autoSelect onChoose={onChoose} />);
    expect(api.log).toHaveLength(0);
    fireEvent.click(screen.getByTestId('find-preview'));
    expect(await screen.findAllByTestId('preview-candidate')).toHaveLength(2);
    expect(api.calls('GET /api/lookup/itunes')[0]?.query.get('title')).toBe('Bring Him Home');
    expect(onChoose).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('preview-candidate')[0]).toHaveTextContent('Great match');
  });

  it('no cast recording → a friendly note and a title search instead; errors can be retried', async () => {
    let fail = true;
    mockFetch({
      'GET /api/catalog/songs/22/recordings': () => json(200, { candidates: [] }),
      'GET /api/lookup/itunes': () => (fail ? json(429, { error: 'Slow down' }) : json(200, { candidates: three })),
    });
    renderWithProviders(<Harness catalogSongId={22} autoLoad autoSelect />);
    expect(await screen.findByText(/couldn’t find a cast recording of this song/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('search-recordings'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many look-ups in a row');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    await waitFor(() => expect(screen.getAllByTestId('preview-candidate')).toHaveLength(2));
    expect(screen.queryByTestId('chosen-preview')).toBeNull();
  });

  // wrong audio is worse than no audio: weak hits (singles, covers, same-titled pop songs) are never picked for you
  it('catalog songs: when no candidate is clearly a cast recording, nothing is picked and the strip says "listen first"', async () => {
    const weak = [
      candidate({ trackId: 7, trackName: 'Tomorrow', collectionName: 'Tomorrow - Single', artistName: 'SR-71', durationSeconds: 211, score: 40, castAlbum: false, albumLabel: null }),
      candidate({ trackId: 8, trackName: 'Prologue', collectionName: 'Prologue (From "Beauty and the Beast") - Single', artistName: 'Moisés Nieto', score: 81, castAlbum: false, albumLabel: null }),
    ];
    mockFetch({ 'GET /api/catalog/songs/22/recordings': () => json(200, { candidates: weak }) });
    const onChoose = vi.fn();
    renderWithProviders(<Harness catalogSongId={22} autoLoad autoSelect onChoose={onChoose} />);
    expect(await screen.findAllByTestId('preview-candidate')).toHaveLength(2);
    expect(onChoose).not.toHaveBeenCalled();
    expect(screen.queryByTestId('chosen-preview')).toBeNull();
    expect(screen.getByTestId('no-recording')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('recordings-unsure')).toHaveTextContent('Possible matches — listen first');
    expect(screen.getByRole('list', { name: 'Possible matches — listen first' })).toBeInTheDocument();
    for (const card of screen.getAllByTestId('preview-candidate')) {
      expect(card).not.toHaveTextContent('Best match');
      expect(card).toHaveTextContent('Listen first');
    }
    // the student can still choose one on purpose
    fireEvent.click(screen.getByTestId('use-preview-0'));
    expect(onChoose).toHaveBeenLastCalledWith(expect.objectContaining({ durationSeconds: 211, castAlbum: false }), 'user');
    expect(screen.getByTestId('chosen-preview')).toHaveTextContent('Recording chosen');
  });

  it('catalog songs: skips a weak hit ranked first and picks the cast recording, badged by what each album is', async () => {
    const list = [
      candidate({ trackId: 8, collectionName: 'Bring Him Home - Single', artistName: 'A Cover Artist', score: 81, castAlbum: false, albumLabel: null }),
      candidate({ trackId: 1, collectionName: 'Les Misérables (Original Broadway Cast Recording)', durationSeconds: 201 }),
      candidate({ trackId: 2, collectionName: 'Les Misérables (Original London Cast Recording)', durationSeconds: 214 }),
    ];
    mockFetch({ 'GET /api/catalog/songs/22/recordings': () => json(200, { candidates: list }) });
    const onChoose = vi.fn();
    renderWithProviders(<Harness catalogSongId={22} autoLoad autoSelect onChoose={onChoose} />);
    expect(await screen.findByTestId('chosen-preview')).toHaveTextContent('Best match — picked for you');
    expect(onChoose).toHaveBeenLastCalledWith(expect.objectContaining({ durationSeconds: 201, castAlbum: true }), 'auto');
    const cards = screen.getAllByTestId('preview-candidate');
    expect(cards[0]).toHaveTextContent('Listen first');
    expect(cards[1]).toHaveTextContent('Best match');
    expect(cards[2]).toHaveTextContent('Original cast recording');
    expect(screen.getByTestId('use-preview-1')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('recordings-unsure')).toBeNull();
  });

  it('every ▶ says which recording it plays (they all share the song title)', async () => {
    mockFetch({ 'GET /api/catalog/songs/22/recordings': () => json(200, { candidates: three }) });
    renderWithProviders(<Harness catalogSongId={22} autoLoad />);
    const cards = await screen.findAllByTestId('preview-candidate');
    const names = cards.map((c) => within(c).getByTestId('play-preview').getAttribute('aria-label'));
    expect(names).toEqual([
      'Play preview of Bring Him Home — Les Misérables (Original Broadway Cast Recording), Colm Wilkinson',
      'Play preview of Bring Him Home — Les Misérables (Original London Cast Recording), Colm Wilkinson',
    ]);
    expect(new Set(names).size).toBe(names.length);
  });

  it('a background load that fails: one "Try again" (no duplicate "Find recordings"), announced politely', async () => {
    let fail = true;
    mockFetch({ 'GET /api/catalog/songs/22/recordings': () => (fail ? json(502, { error: 'Couldn’t reach Apple Music right now' }) : json(200, { candidates: three })) });
    renderWithProviders(<Harness catalogSongId={22} autoLoad autoSelect />);
    const err = await screen.findByTestId('recordings-error');
    expect(err).toHaveTextContent('Couldn’t reach Apple Music right now');
    expect(err).not.toHaveAttribute('role', 'alert');
    expect(screen.getByTestId('recordings-status')).toContainElement(err); // inside the polite live region
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByTestId('find-preview')).toBeNull();
    expect(screen.getAllByRole('button', { name: /Try again/ })).toHaveLength(1);

    // the student's own retry that fails again interrupts (role=alert)
    fireEvent.click(within(err).getByRole('button', { name: /Try again/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t reach Apple Music right now');
    expect(screen.queryByTestId('find-preview')).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findByTestId('chosen-preview')).toHaveTextContent('Best match — picked for you');
  });
});
