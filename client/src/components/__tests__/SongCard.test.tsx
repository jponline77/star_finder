import { describe, expect, it } from 'vitest';
import { screen, within, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../test/render';
import { makeSong, part } from '../../test/fixtures';
import { SongCard } from '../SongCard';
import { LengthBadge } from '../LengthBadge';
import { RangeBadge } from '../RangeBadge';
import { VoiceLadder } from '../VoiceLadder';

const song = makeSong({
  id: 42,
  kind: 'duet',
  title: 'A Heart Full of Love',
  show: { id: 2, name: 'Les Misérables', slug: 'les-miserables', imageUrl: null },
  genre: 'Romantic',
  subGenre: 'In Love',
  lengthSeconds: 345,
  mature: true,
  parts: [part('Cosette', 'Soprano', 1), part('Marius', 'Tenor', 2)],
  media: { ...makeSong().media, previewUrl: 'https://audio-ssl.itunes.apple.com/x.m4a' },
  source: 'community',
  createdBy: { id: 3, displayName: 'Belter' },
  commentCount: 4,
});

describe('SongCard', () => {
  it('renders the key song info with test ids', () => {
    renderWithProviders(<SongCard song={song} />);
    const card = screen.getByTestId('song-card');
    expect(within(card).getByTestId('song-title')).toHaveTextContent('A Heart Full of Love');
    expect(within(card).getByTestId('song-title')).toHaveAttribute('href', '/songs/42');
    expect(within(card).getByRole('link', { name: 'Les Misérables' })).toHaveAttribute('href', '/shows/les-miserables');
    expect(card).toHaveTextContent('Cosette');
    expect(card).toHaveTextContent('Marius');
    expect(card).toHaveTextContent('Community');
    expect(card).toHaveTextContent('Mature');
    expect(card).toHaveTextContent('5:45');
    expect(card).toHaveTextContent('Close to the limit');
    expect(card).toHaveTextContent('4 comments');
    expect(within(card).getByTestId('play-preview')).toHaveAccessibleName('Play preview of A Heart Full of Love');
  });

  it('highlights search matches accent-insensitively', () => {
    renderWithProviders(<SongCard song={song} query="miserables" />);
    const marks = document.querySelectorAll('mark');
    expect([...marks].map((m) => m.textContent)).toContain('Misérables');
  });

  it('hides the play button when nothing is playable', () => {
    renderWithProviders(<SongCard song={makeSong()} />);
    expect(screen.queryByTestId('play-preview')).toBeNull();
  });

  it('toggles the setlist heart', () => {
    renderWithProviders(<SongCard song={song} />);
    const heart = screen.getByTestId('setlist-heart');
    expect(heart).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(heart);
    expect(heart).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(window.localStorage.getItem('star.setlist.v1') ?? '[]')).toContain(42);
  });
});

describe('badges', () => {
  it('LengthBadge is not colour-only', () => {
    const { rerender } = renderWithProviders(<LengthBadge seconds={400} />);
    expect(screen.getByText(/Over 6:00/)).toBeInTheDocument();
    rerender(<LengthBadge seconds={null} />);
  });
  it('RangeBadge exposes the full name', () => {
    renderWithProviders(<RangeBadge range="mezzo" />);
    expect(screen.getByTitle('Mezzo-soprano')).toHaveTextContent('Mz');
    expect(screen.getByText('Mezzo-soprano')).toHaveClass('visually-hidden');
  });
  it('VoiceLadder labels the highlighted ranges', () => {
    renderWithProviders(<VoiceLadder ranges={['Tenor', 'Soprano', null]} />);
    expect(screen.getByRole('img')).toHaveAccessibleName(/Soprano and Tenor highlighted/);
  });
});
