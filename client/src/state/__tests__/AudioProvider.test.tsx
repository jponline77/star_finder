import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { makeSong } from '../../test/fixtures';
import { renderWithProviders } from '../../test/render';
import { APPLE_PREVIEW_CREDIT, songTrack, useAudio } from '../AudioProvider';
import { MiniPlayer } from '../../components/MiniPlayer';
import { PlayButton } from '../../components/PlayButton';

const media = makeSong().media;

describe('songTrack', () => {
  it('prefers the Apple preview, then uploaded audio', () => {
    const both = makeSong({ id: 5, media: { ...media, previewUrl: 'https://p.mzstatic.com/a.m4a', audioUrl: '/uploads/audio/a.mp3' } });
    expect(songTrack(both)).toMatchObject({ key: 'song:5', src: 'https://p.mzstatic.com/a.m4a', credit: APPLE_PREVIEW_CREDIT, songId: 5 });
    expect(songTrack(both, 'upload')).toMatchObject({ key: 'upload:5', src: '/uploads/audio/a.mp3' });
    const uploadOnly = makeSong({ id: 6, media: { ...media, audioUrl: '/uploads/audio/b.mp3' } });
    expect(songTrack(uploadOnly)?.key).toBe('upload:6');
    expect(songTrack(uploadOnly, 'preview')).toBeNull();
    expect(songTrack(makeSong({ media: { ...media, audioLink: 'https://youtube.com/x' } }))).toBeNull();
  });
});

function Status() {
  const a = useAudio();
  return <p data-testid="status">{a.current ? `${a.current.title}:${a.status}` : 'idle'}</p>;
}

describe('AudioProvider + MiniPlayer', () => {
  it('shows the mini player for the current song and closes it', () => {
    const song = makeSong({ id: 9, title: 'Popular', media: { ...media, previewUrl: 'https://p.mzstatic.com/a.m4a' } });
    renderWithProviders(
      <>
        <PlayButton song={song} />
        <Status />
        <MiniPlayer />
      </>,
    );
    expect(screen.queryByTestId('mini-player')).toBeNull();
    fireEvent.click(screen.getByTestId('play-preview'));
    expect(screen.getByTestId('status')).toHaveTextContent(/^Popular:/);
    expect(screen.getByTestId('mini-player-title')).toHaveTextContent('Popular');
    expect(screen.getByTestId('mini-player-title')).toHaveAttribute('href', '/songs/9');
    expect(screen.getByText(APPLE_PREVIEW_CREDIT)).toBeInTheDocument();
    expect(document.body).toHaveClass('has-mini-player');
    // reserves room at the bottom so focused controls scroll clear of the player
    expect(document.documentElement).toHaveClass('has-mini-player');
    expect(document.documentElement.style.getPropertyValue('--mini-player-offset')).toMatch(/^\d+px$/);
    fireEvent.click(screen.getByTestId('mini-player-close'));
    expect(screen.queryByTestId('mini-player')).toBeNull();
    expect(screen.getByTestId('status')).toHaveTextContent('idle');
    expect(document.body).not.toHaveClass('has-mini-player');
    expect(document.documentElement).not.toHaveClass('has-mini-player');
    expect(document.documentElement.style.getPropertyValue('--mini-player-offset')).toBe('');
  });
});

describe('AudioProvider retry after a failed load', () => {
  afterEach(() => vi.restoreAllMocks());

  it('re-requests the same preview when play is pressed again after an error', async () => {
    const song = makeSong({ id: 17, title: 'Wait For Me', media: { ...media, previewUrl: 'https://p.mzstatic.com/w.m4a' } });
    let el: HTMLMediaElement | null = null;
    let attempts = 0;
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load');
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
      el = this;
      attempts += 1;
      if (attempts === 1) {
        // first attempt: the network drops — the element fires 'error' and play() rejects
        this.dispatchEvent(new Event('error'));
        return Promise.reject(new DOMException('Failed to load because no supported source was found.', 'NotSupportedError'));
      }
      return Promise.resolve();
    });
    renderWithProviders(
      <>
        <PlayButton song={song} />
        <Status />
        <MiniPlayer />
      </>,
    );
    fireEvent.click(screen.getByTestId('play-preview'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('Wait For Me:error'));
    expect(load).not.toHaveBeenCalled();

    // same song again → the element must be reset (load) before play so the file is fetched again
    fireEvent.click(screen.getByTestId('play-preview'));
    expect(load).toHaveBeenCalledTimes(1);
    expect(attempts).toBe(2);
    expect(load.mock.invocationCallOrder[0]).toBeLessThan(
      (HTMLMediaElement.prototype.play as unknown as { mock: { invocationCallOrder: number[] } }).mock.invocationCallOrder[1],
    );
    act(() => {
      el!.dispatchEvent(new Event('playing'));
    });
    expect(screen.getByTestId('status')).toHaveTextContent('Wait For Me:playing');

    // a healthy element is not reloaded on pause/resume
    fireEvent.click(screen.getByTestId('mini-player-toggle'));
    fireEvent.click(screen.getByTestId('mini-player-toggle'));
    expect(load).toHaveBeenCalledTimes(1);
    expect(attempts).toBe(3);
  });
});
