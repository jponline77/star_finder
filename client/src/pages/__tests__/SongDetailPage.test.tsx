import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/render';
import { makeShow, makeSong, makeUser, part } from '../../test/fixtures';
import type { ShowDetail, Song, SongDetail } from '../../types';
import * as api from '../../api';
import SongDetailPage from '../SongDetailPage';

vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api')>();
  return {
    ...actual,
    getSong: vi.fn(),
    getShow: vi.fn(),
    listComments: vi.fn(),
    deleteSong: vi.fn(),
    uploadSongAudio: vi.fn(),
    deleteSongAudio: vi.fn(),
    uploadSongArtwork: vi.fn(),
    deleteSongArtwork: vi.fn(),
    updateSong: vi.fn(),
    getCatalogRecordings: vi.fn(),
    lookupItunes: vi.fn(),
    listSongs: vi.fn(),
    getMeta: vi.fn(),
  };
});

const mocked = vi.mocked(api);

const shrek = { id: 2, name: 'Shrek The Musical', slug: 'shrek-the-musical', imageUrl: null };

const song: Song = makeSong({
  id: 8,
  kind: 'duet',
  title: 'Who I’d Be',
  show: shrek,
  genre: 'Drama',
  subGenre: 'Longing',
  lengthSeconds: 240,
  notes: 'In the show Donkey also sings a few lines, so this is really a trio.',
  parts: [part('Shrek', 'Baritone', 1), part('Fiona', 'Mezzo-soprano', 2)],
  media: {
    previewUrl: 'https://audio-ssl.itunes.apple.com/preview.m4a',
    artworkUrl: '/media/art/abc.jpg',
    appleMusicUrl: 'https://music.apple.com/ca/album/who-id-be/1',
    recordingName: 'Shrek the Musical (Original Cast Recording)',
    recordingArtist: 'Brian d’Arcy James',
    audioUrl: null,
    audioLink: null,
  },
  commentCount: 2,
});

const similar = [
  makeSong({ id: 64, title: 'A Little Fall of Rain', kind: 'duet' }),
  makeSong({ id: 60, title: 'Come To Me', kind: 'duet' }),
];

const show: ShowDetail = {
  ...makeShow({
    id: 2,
    name: 'Shrek The Musical',
    slug: 'shrek-the-musical',
    composer: 'Jeanine Tesori',
    lyricist: 'David Lindsay-Abaire',
    bookWriter: 'David Lindsay-Abaire',
    year: 2008,
    licensor: 'Music Theatre International (MTI)',
    licensingNote: 'A School Edition also exists.',
    description: 'A grumpy ogre wants his swamp back.',
    songCount: 6,
  }),
  songs: [],
  characters: [],
};

const detail = (s: Song, sim: Song[] = similar): SongDetail => ({ ...s, similar: sim });

function setup(opts: { song?: Song; user?: ReturnType<typeof makeUser> | null; route?: string } = {}) {
  const s = opts.song ?? song;
  mocked.getSong.mockResolvedValue(detail(s));
  mocked.getShow.mockResolvedValue(show);
  return renderWithProviders(<SongDetailPage />, { route: opts.route ?? `/songs/${s.id}`, path: '/songs/:id', user: opts.user ?? null });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocked.listComments.mockResolvedValue({ comments: [] });
  mocked.listSongs.mockResolvedValue({ songs: [], total: 0 });
});

describe('SongDetailPage', () => {
  it('renders the hero, credits, parts, timing, note, checklist, links and similar songs', async () => {
    setup();
    expect(await screen.findByTestId('song-detail-title')).toHaveTextContent('Who I’d Be');
    expect(screen.getByTestId('song-show-link')).toHaveAttribute('href', '/shows/shrek-the-musical');
    expect(screen.getByTestId('hero-show-poster')).toHaveAttribute('href', '/shows/shrek-the-musical');
    expect(await screen.findByTestId('song-credits')).toHaveTextContent('Music by Jeanine Tesori · Lyrics by David Lindsay-Abaire');
    await waitFor(() => expect(document.title).toBe('Who I’d Be — Shrek The Musical · STAR Song Finder'));

    // parts + voice ladders
    const parts = screen.getAllByTestId('song-part');
    expect(parts).toHaveLength(2);
    expect(within(parts[0]!).getByText('Shrek')).toBeInTheDocument();
    expect(within(parts[0]!).getByRole('img', { name: /Baritone highlighted/ })).toBeInTheDocument();
    expect(within(parts[1]!).getByRole('img', { name: /Mezzo-soprano highlighted/ })).toBeInTheDocument();

    // genre links + timing + director's note
    expect(screen.getByRole('link', { name: /Drama/ })).toHaveAttribute('href', '/songs?genre=Drama');
    expect(screen.getByRole('link', { name: /Longing/ })).toHaveAttribute('href', '/songs?subGenre=Longing');
    expect(screen.getByTestId('timing-headline')).toHaveTextContent('Fits STAR’s 6:00 limit');
    expect(screen.getByTestId('directors-note')).toHaveTextContent('really a trio');
    expect(screen.getByTestId('directors-note')).toHaveTextContent('research crew');
    expect(screen.queryByTestId('mature-note')).not.toBeInTheDocument();

    // audio + resources
    expect(screen.getByTestId('preview-credit')).toHaveTextContent(
      'Preview courtesy of Apple Music — Shrek the Musical (Original Cast Recording) · Brian d’Arcy James',
    );
    expect(screen.getByTestId('apple-music-link')).toHaveAttribute('href', 'https://music.apple.com/ca/album/who-id-be/1');
    expect(screen.getByTestId('link-backing-track').getAttribute('href')).toBe(
      `https://www.youtube.com/results?search_query=${encodeURIComponent('"Who I’d Be" "Shrek The Musical" karaoke instrumental')}`,
    );
    expect(screen.getByTestId('link-sheet-music').getAttribute('href')).toContain('musicnotes.com');
    expect(screen.getByTestId('link-performances')).toHaveAttribute('target', '_blank');

    // checklist
    const checklist = screen.getByTestId('star-checklist');
    expect(within(checklist).getByTestId('check-time')).toHaveAttribute('data-status', 'ok');
    expect(within(checklist).getByTestId('check-fit')).toHaveTextContent('Duet = two characters');
    expect(within(checklist).getByTestId('check-fit')).toHaveTextContent('Shrek & Fiona');
    expect(within(checklist).getByTestId('check-stage')).toHaveTextContent('up to 2 chairs + 1 table');
    await waitFor(() => expect(within(checklist).getByTestId('check-licensing')).toHaveTextContent('Licensed by Music Theatre International (MTI)'));
    expect(within(checklist).getByTestId('check-licensing')).toHaveTextContent('Always confirm with your teacher');

    // slate uses the show credits
    await waitFor(() => expect(screen.getByTestId('slate-text')).toHaveTextContent('from Shrek The Musical by Jeanine Tesori and David Lindsay-Abaire'));
    expect(screen.getByTestId('slate-text')).toHaveTextContent('Our names are [Name 1] and [Name 2]');

    // similar + comments
    const similarSection = await screen.findByTestId('similar-songs');
    await waitFor(() => expect(within(similarSection).getAllByTestId('song-card')).toHaveLength(2));
    expect(await screen.findByTestId('comments-section')).toBeInTheDocument();
    expect(mocked.getShow).toHaveBeenCalledWith('shrek-the-musical', expect.anything());
  });

  it('flags over-limit and mature songs, and the checklist says so', async () => {
    setup({ song: makeSong({ id: 70, title: 'Corn', lengthSeconds: 406, mature: true, show: shrek }) });
    expect(await screen.findByTestId('timing-headline')).toHaveTextContent('Over STAR’s 6:00 limit — you’ll need a cut');
    expect(screen.getByTestId('mature-note')).toBeInTheDocument();
    expect(screen.getByTestId('check-time')).toHaveAttribute('data-status', 'bad');
    expect(screen.getByTestId('check-content')).toHaveAttribute('data-status', 'warn');
    expect(screen.getByTestId('check-stage')).toHaveTextContent('up to 1 chair + 1 table');
  });

  it('shows the 404 state when the song is not in the program', async () => {
    mocked.getSong.mockRejectedValue(new api.ApiError(404, 'Song not found'));
    renderWithProviders(<SongDetailPage />, { route: '/songs/999', path: '/songs/:id' });
    expect(await screen.findByTestId('song-not-found')).toHaveTextContent('This song isn’t in our program');
    expect(screen.getByRole('link', { name: 'Browse all songs' })).toHaveAttribute('href', '/songs');
  });

  it('treats a non-numeric id as not found without calling the API', () => {
    renderWithProviders(<SongDetailPage />, { route: '/songs/abc', path: '/songs/:id' });
    expect(screen.getByTestId('song-not-found')).toBeInTheDocument();
    expect(mocked.getSong).not.toHaveBeenCalled();
  });

  it('shows an error with a working retry', async () => {
    mocked.getSong.mockRejectedValueOnce(new api.ApiError(0, 'Can’t reach the server'));
    mocked.getShow.mockResolvedValue(show);
    renderWithProviders(<SongDetailPage />, { route: '/songs/8', path: '/songs/:id' });
    expect(await screen.findByText('The curtain got stuck!')).toBeInTheDocument();
    mocked.getSong.mockResolvedValueOnce(detail(song));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('song-detail-title')).toHaveTextContent('Who I’d Be');
  });

  it('hides owner tools when logged out or not the owner', async () => {
    setup({ user: makeUser({ id: 99 }), song: makeSong({ id: 5, source: 'community', createdBy: { id: 7, displayName: 'Stage Kid' }, show: shrek }) });
    await screen.findByTestId('song-detail-title');
    expect(screen.getByTestId('community-ribbon')).toBeInTheDocument();
    expect(screen.getByTestId('added-by')).toHaveTextContent('Added by Stage Kid');
    expect(screen.queryByTestId('edit-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('delete-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('audio-manager')).not.toBeInTheDocument();
  });

  it('signs a community song’s note with the person who added it', async () => {
    setup({ song: makeSong({ id: 5, source: 'community', notes: 'Cut the second verse.', createdBy: { id: 7, displayName: 'Stage Kid' }, show: shrek }) });
    const note = await screen.findByTestId('directors-note');
    expect(note).toHaveTextContent('Cut the second verse.');
    expect(note).toHaveTextContent('Stage Kid, who added this song');
    expect(note).not.toHaveTextContent('research crew');
  });

  it('lets an admin manage a spreadsheet song', async () => {
    setup({ user: makeUser({ id: 1, role: 'admin' }) });
    await screen.findByTestId('song-detail-title');
    expect(screen.getByTestId('edit-button')).toHaveAttribute('href', '/songs/8/edit');
    expect(screen.getByTestId('audio-manager')).toBeInTheDocument();
  });

  it('owner: validates, uploads and removes audio', async () => {
    const mine = makeSong({ id: 5, title: 'My Song', source: 'community', createdBy: { id: 7, displayName: 'Stage Kid' }, show: shrek });
    const withAudio = { ...mine, media: { ...mine.media, audioUrl: '/uploads/audio/x.mp3' } };
    setup({ user: makeUser({ id: 7 }), song: mine });
    await screen.findByTestId('audio-manager');
    expect(screen.getByTestId('no-audio')).toBeInTheDocument();

    const input = screen.getByTestId('audio-file-input');
    fireEvent.change(input, { target: { files: [new File(['hello'], 'notes.txt', { type: 'text/plain' })] } });
    expect(await screen.findByTestId('audio-upload-error')).toHaveTextContent('doesn’t look like an audio file');
    expect(mocked.uploadSongAudio).not.toHaveBeenCalled();

    mocked.uploadSongAudio.mockResolvedValue(withAudio);
    const file = new File([new Uint8Array(2048)], 'backing.mp3', { type: 'audio/mpeg' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByTestId('uploaded-track')).toBeInTheDocument();
    expect(mocked.uploadSongAudio).toHaveBeenCalledWith(5, file, expect.objectContaining({ onProgress: expect.any(Function) }));
    expect(screen.queryByTestId('audio-upload-error')).not.toBeInTheDocument();

    mocked.deleteSongAudio.mockResolvedValue(mine);
    fireEvent.click(screen.getByTestId('audio-remove'));
    fireEvent.click(await screen.findByTestId('confirm-button'));
    await waitFor(() => expect(screen.queryByTestId('uploaded-track')).not.toBeInTheDocument());
    expect(mocked.deleteSongAudio).toHaveBeenCalledWith(5);
  });

  it('shows server upload errors inline', async () => {
    const mine = makeSong({ id: 5, source: 'community', createdBy: { id: 7, displayName: 'Stage Kid' }, show: shrek });
    setup({ user: makeUser({ id: 7 }), song: mine });
    mocked.uploadSongAudio.mockRejectedValue(new api.ApiError(413, 'That file is too big (max 25 MB)'));
    fireEvent.change(await screen.findByTestId('audio-file-input'), { target: { files: [new File(['x'], 'huge.wav', { type: 'audio/wav' })] } });
    expect(await screen.findByTestId('audio-upload-error')).toHaveTextContent('too big');
  });

  it('upload quota / busy server: shows what the server said (not "file too big")', async () => {
    const mine = makeSong({ id: 5, source: 'community', createdBy: { id: 7, displayName: 'Stage Kid' }, show: shrek });
    setup({ user: makeUser({ id: 7 }), song: mine });
    mocked.uploadSongAudio.mockRejectedValueOnce(new api.ApiError(413, 'You’ve used all your upload space (200 MB) — remove an old upload first'));
    fireEvent.change(await screen.findByTestId('audio-file-input'), { target: { files: [new File(['x'], 'small.mp3', { type: 'audio/mpeg' })] } });
    expect(await screen.findByTestId('audio-upload-error')).toHaveTextContent('used all your upload space');
    expect(screen.getByTestId('audio-upload-error')).not.toHaveTextContent('max 25 MB');

    mocked.uploadSongAudio.mockRejectedValueOnce(new api.ApiError(507, 'The server is almost out of storage space, so uploads are paused — please tell your teacher'));
    fireEvent.change(screen.getByTestId('audio-file-input'), { target: { files: [new File(['x'], 'small.mp3', { type: 'audio/mpeg' })] } });
    await waitFor(() => expect(screen.getByTestId('audio-upload-error')).toHaveTextContent('uploads are paused'));
  });

  it('owner: deletes the song after confirming and goes back to /songs', async () => {
    const mine = makeSong({ id: 5, title: 'My Song', source: 'community', createdBy: { id: 7, displayName: 'Stage Kid' }, show: shrek });
    mocked.deleteSong.mockResolvedValue(undefined);
    const { router } = setup({ user: makeUser({ id: 7 }), song: mine });
    fireEvent.click(await screen.findByTestId('delete-button'));
    expect(await screen.findByRole('alertdialog', { name: 'Delete “My Song”?' })).toHaveTextContent('can’t be undone');
    fireEvent.click(screen.getByTestId('confirm-button'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/songs'));
    expect(mocked.deleteSong).toHaveBeenCalledWith(5);
    expect(await screen.findByText('“My Song” was deleted')).toBeInTheDocument();
  });

  it('keeps the hero comment count in sync with Backstage Chatter', async () => {
    mocked.listComments.mockResolvedValue({
      comments: [
        { id: 1, body: 'Great belt song', tag: 'tip', author: { id: 3, displayName: 'A', role: 'user' }, target: { type: 'song', id: 8, title: 'x' }, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', edited: false },
      ],
    });
    setup();
    await waitFor(() => expect(screen.getByTestId('comment-count-link')).toHaveTextContent('1 comment'));
    expect(screen.getByTestId('comment-count-link')).toHaveAttribute('href', '#chatter');
  });

  describe('album art & audio panel (SPEC §7c)', () => {
    const media = makeSong().media;
    const mine = makeSong({
      id: 5,
      title: 'My Song',
      source: 'community',
      createdBy: { id: 7, displayName: 'Stage Kid' },
      show: shrek,
      lengthSeconds: null,
      catalogSongId: 77,
      genre: 'Comedy',
      parts: [part('Donkey', 'Tenor')],
    });

    it('owners get friendly empty states: "Add album art" and "Add a backing track"', async () => {
      setup({ user: makeUser({ id: 7 }), song: mine });
      expect(await screen.findByTestId('media-panel')).toHaveTextContent('only you and admins see this');
      expect(screen.getByTestId('hero-add-art')).toHaveTextContent('Add album art');
      expect(screen.getByTestId('add-backing-track')).toHaveTextContent('Add a backing track');
      expect(screen.getByRole('heading', { name: /Add album art/ })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /Add your backing track \(no vocals\)/ })).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('hero-add-art'));
      expect(document.activeElement).toBe(screen.getByTestId('art-choose'));
      fireEvent.click(screen.getByTestId('add-backing-track'));
      expect(document.activeElement).toBe(screen.getByTestId('audio-choose'));
    });

    it('visitors see no media tools', async () => {
      setup({ user: null, song: mine });
      await screen.findByTestId('song-detail-title');
      expect(screen.queryByTestId('media-panel')).toBeNull();
      expect(screen.queryByTestId('hero-add-art')).toBeNull();
      expect(screen.queryByTestId('add-backing-track')).toBeNull();
    });

    it('uploads album art straight away (checked first), then can go back to the recording’s art', async () => {
      const withRecording = { ...mine, media: { ...media, previewUrl: 'https://audio-ssl.itunes.apple.com/p.m4a', recordingName: 'Shrek (OBC)', artworkUrl: '/uploads/art/rec.jpg', artworkSource: 'recording' as const } };
      const uploaded = { ...withRecording, media: { ...withRecording.media, artworkUrl: '/uploads/art/mine.png', artworkSource: 'upload' as const } };
      setup({ user: makeUser({ id: 7 }), song: withRecording });
      await screen.findByTestId('media-panel');
      expect(screen.getByTestId('art-preview')).toHaveAttribute('data-state', 'recording');
      expect(screen.queryByTestId('hero-add-art')).toBeNull();
      fireEvent.change(screen.getByTestId('art-file-input'), { target: { files: [new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })] } });
      expect(screen.getByTestId('art-upload-error')).toHaveTextContent('SVG');
      expect(mocked.uploadSongArtwork).not.toHaveBeenCalled();

      mocked.uploadSongArtwork.mockResolvedValue(uploaded);
      const file = new File([new Uint8Array(2048)], 'mine.png', { type: 'image/png' });
      fireEvent.change(screen.getByTestId('art-file-input'), { target: { files: [file] } });
      await waitFor(() => expect(screen.getByTestId('art-preview')).toHaveAttribute('data-state', 'upload'));
      expect(mocked.uploadSongArtwork).toHaveBeenCalledWith(5, file, expect.objectContaining({ onProgress: expect.any(Function) }));
      expect(screen.queryByTestId('art-remove')).toBeNull(); // with a recording, "Use recording art" is the way back

      mocked.deleteSongArtwork.mockResolvedValue(withRecording);
      fireEvent.click(screen.getByTestId('art-use-recording'));
      fireEvent.click(await screen.findByTestId('confirm-button'));
      await waitFor(() => expect(screen.getByTestId('art-preview')).toHaveAttribute('data-state', 'recording'));
      expect(mocked.deleteSongArtwork).toHaveBeenCalledWith(5);
    });

    it('shows a friendly error when the art upload is refused', async () => {
      setup({ user: makeUser({ id: 7 }), song: mine });
      await screen.findByTestId('media-panel');
      mocked.uploadSongArtwork.mockRejectedValue(new api.ApiError(413, 'Too big'));
      fireEvent.change(screen.getByTestId('art-file-input'), { target: { files: [new File([new Uint8Array(10)], 'a.jpg', { type: 'image/jpeg' })] } });
      expect(await screen.findByTestId('art-upload-error')).toHaveTextContent('too big (max 5 MB)');
    });

    it('changes the recording (PUT with the song’s own fields) and offers its length', async () => {
      const withTrack = { ...mine, media: { ...media, previewUrl: 'https://audio-ssl.itunes.apple.com/p.m4a', recordingName: 'Shrek (OBC)' } };
      mocked.getCatalogRecordings.mockResolvedValue({
        candidates: [
          { trackId: 1, trackName: 'My Song', collectionName: 'Shrek (OBC)', artistName: 'Cast', previewUrl: 'https://audio-ssl.itunes.apple.com/p.m4a', artworkUrl: null, appleMusicUrl: null, durationSeconds: 150, score: 90 },
          { trackId: 2, trackName: 'My Song', collectionName: 'Shrek (London)', artistName: 'Cast', previewUrl: 'https://audio-ssl.itunes.apple.com/q.m4a', artworkUrl: null, appleMusicUrl: null, durationSeconds: 163, score: 80 },
        ],
      });
      setup({ user: makeUser({ id: 7 }), song: withTrack });
      expect(await screen.findByTestId('current-recording')).toHaveTextContent('Shrek (OBC)');
      fireEvent.click(screen.getByTestId('change-recording'));
      await screen.findAllByTestId('preview-candidate');
      expect(mocked.getCatalogRecordings).toHaveBeenCalledWith(77, expect.any(AbortSignal));
      expect(screen.getByTestId('use-preview-0')).toHaveAttribute('aria-pressed', 'true'); // the current one
      expect(screen.queryByTestId('chosen-preview')).toBeNull();

      const switched = { ...withTrack, media: { ...withTrack.media, previewUrl: 'https://audio-ssl.itunes.apple.com/q.m4a', recordingName: 'Shrek (London)' } };
      mocked.updateSong.mockResolvedValueOnce(switched);
      fireEvent.click(screen.getByTestId('use-preview-1'));
      await waitFor(() => expect(screen.getByTestId('current-recording')).toHaveTextContent('Shrek (London)'));
      const [id, body] = mocked.updateSong.mock.calls[0]!;
      expect(id).toBe(5);
      expect(body).toMatchObject({ kind: 'solo', title: 'My Song', showId: 2, genre: 'Comedy', catalogSongId: 77, parts: [{ character: 'Donkey', vocalRange: 'Tenor' }] });
      expect(body.preview).toMatchObject({ itunesTrackId: 2, recordingName: 'Shrek (London)' });

      const chip = await screen.findByTestId('recording-length-suggestion');
      expect(chip).toHaveTextContent('Suggested: 2:43');
      mocked.updateSong.mockResolvedValueOnce({ ...switched, lengthSeconds: 163 });
      fireEvent.click(screen.getByTestId('recording-length-suggestion-apply'));
      await waitFor(() => expect(mocked.updateSong).toHaveBeenCalledTimes(2));
      expect(mocked.updateSong.mock.calls[1]![1]).toMatchObject({ lengthSeconds: 163 });
      await waitFor(() => expect(screen.queryByTestId('recording-length-suggestion')).toBeNull());
    });

    it('keeps keyboard focus when the recording picker opens, closes, or saves a choice', async () => {
      const withTrack = { ...mine, media: { ...media, previewUrl: 'https://audio-ssl.itunes.apple.com/p.m4a', recordingName: 'Shrek (OBC)' } };
      mocked.getCatalogRecordings.mockResolvedValue({
        candidates: [
          { trackId: 1, trackName: 'My Song', collectionName: 'Shrek (OBC)', artistName: 'Cast', previewUrl: 'https://audio-ssl.itunes.apple.com/p.m4a', artworkUrl: null, appleMusicUrl: null, durationSeconds: 150, score: 90, castAlbum: true, albumLabel: 'original cast recording' },
          { trackId: 2, trackName: 'My Song', collectionName: 'Shrek (London)', artistName: 'Cast', previewUrl: 'https://audio-ssl.itunes.apple.com/q.m4a', artworkUrl: null, appleMusicUrl: null, durationSeconds: 163, score: 88, castAlbum: true, albumLabel: 'cast recording' },
        ],
      });
      setup({ user: makeUser({ id: 7 }), song: withTrack });
      const open = await screen.findByTestId('change-recording');
      act(() => open.focus());
      fireEvent.click(open);
      // opening: focus lands on the picker (not <body>)
      await waitFor(() => expect(screen.getByTestId('recording-picker-region')).toHaveFocus());
      expect(screen.getByTestId('recording-picker-region')).toHaveAccessibleName('Choose a recording');
      await screen.findAllByTestId('preview-candidate');
      // every ▶ names its album
      expect(screen.getAllByTestId('play-preview').map((b) => b.getAttribute('aria-label'))).toEqual(
        expect.arrayContaining(['Play preview of My Song — Shrek (OBC), Cast', 'Play preview of My Song — Shrek (London), Cast']),
      );

      // Close → back on the button that opened it
      const close = screen.getByTestId('close-recordings');
      act(() => close.focus());
      fireEvent.click(close);
      await waitFor(() => expect(screen.getByTestId('change-recording')).toHaveFocus());

      // choose another → saved → back on the button
      fireEvent.click(screen.getByTestId('change-recording'));
      await screen.findAllByTestId('preview-candidate');
      mocked.updateSong.mockResolvedValueOnce({ ...withTrack, media: { ...withTrack.media, previewUrl: 'https://audio-ssl.itunes.apple.com/q.m4a', recordingName: 'Shrek (London)' } });
      const use = screen.getByTestId('use-preview-1');
      act(() => use.focus());
      fireEvent.click(use);
      await waitFor(() => expect(screen.getByTestId('current-recording')).toHaveTextContent('Shrek (London)'));
      await waitFor(() => expect(screen.getByTestId('change-recording')).toHaveFocus());
      expect(document.activeElement).not.toBe(document.body);
    });
  });
});
