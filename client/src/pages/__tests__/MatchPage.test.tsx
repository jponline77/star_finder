import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/render';
import { makeMeta, makeSong, part } from '../../test/fixtures';
import MatchPage from '../MatchPage';

const songs = [
  makeSong({ id: 1, title: 'Popular', kind: 'solo', genre: 'Comedy', subGenre: 'Satire', lengthSeconds: 140, parts: [part('Glinda', 'Soprano')] }),
  makeSong({ id: 2, title: 'Stars', kind: 'solo', genre: 'Drama', subGenre: 'Power', lengthSeconds: 200, parts: [part('Javert', 'Baritone')] }),
  makeSong({
    id: 3,
    title: 'A Heart Full of Love',
    kind: 'duet',
    genre: 'Romantic',
    subGenre: 'In Love',
    lengthSeconds: 170,
    parts: [part('Cosette', 'Soprano', 1), part('Marius', 'Tenor', 2)],
  }),
  makeSong({ id: 4, title: 'Epiphany', kind: 'solo', genre: 'Drama', subGenre: 'Intimidating / Angry', mature: true, lengthSeconds: 400, parts: [part('Sweeney', 'Baritone')] }),
  makeSong({ id: 5, title: 'Satire Song', kind: 'solo', genre: 'Comedy', subGenre: 'Tongue-in-Cheek', lengthSeconds: 190, parts: [part('Someone', 'Mezzo-soprano')] }),
];

const render = (route = '/match') => renderWithProviders(<MatchPage />, { route, path: '/match', songs, meta: makeMeta() });
const step = () => screen.getByTestId('match-step');

describe('MatchPage quiz', () => {
  it('starts on question 1 with counts, and one tap answers + advances (answers go in the URL)', async () => {
    const { router } = render();
    expect(step()).toHaveAttribute('data-step', '1');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Find your perfect song match');
    expect(screen.getByTestId('match-kind-solo')).toHaveTextContent('4 songs');
    expect(screen.getByTestId('match-kind-duet')).toHaveTextContent('1 song');
    expect(screen.getByTestId('match-next')).toBeDisabled();

    fireEvent.click(screen.getByTestId('match-kind-solo'));
    expect(screen.getByTestId('match-kind-solo')).toHaveAttribute('aria-pressed', 'true');
    expect(router.state.location.search).toBe('?kind=solo');
    await waitFor(() => expect(step()).toHaveAttribute('data-step', '2'));
    expect(router.state.location.search).toBe('?kind=solo&step=2');
    // focus follows the new question
    expect(document.activeElement).toHaveTextContent('What’s your voice type?');
  });

  it('shows the voice helper and "not sure" option, and counts songs per range for the chosen kind', async () => {
    render('/match?kind=solo&step=2');
    expect(screen.getByTestId('match-range-Baritone')).toHaveTextContent('2 songs');
    expect(screen.getByTestId('match-range-Tenor')).toHaveTextContent('0 songs');
    expect(screen.getByTestId('voice-helper')).toHaveTextContent('Not sure what your voice type is?');
    expect(screen.getByTestId('voice-helper')).toHaveTextContent('The deepest voice');
    fireEvent.click(screen.getByTestId('match-range-any'));
    await waitFor(() => expect(step()).toHaveAttribute('data-step', '3'));
  });

  it('asks for both voices on a duet and only advances once both are picked', async () => {
    // Fake timers: run the clock well past the auto-advance delay deterministically instead of
    // racing a real-time sleep against it.
    vi.useFakeTimers();
    try {
      const { router } = render('/match?kind=duet&step=2');
      expect(screen.getByRole('group', { name: 'Your partner’s voice' })).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('match-range-Tenor'));
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(step()).toHaveAttribute('data-step', '2');
      fireEvent.click(screen.getByTestId('match-partner-Soprano'));
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(step()).toHaveAttribute('data-step', '3');
      expect(router.state.location.search).toContain('partner=Soprano');
    } finally {
      vi.useRealTimers();
    }
  });

  it('offers mood chips once a vibe is chosen, then Next moves on', async () => {
    const { router } = render('/match?kind=solo&range=Soprano&step=3');
    expect(screen.queryByTestId('match-mood-Satire')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('match-genre-Comedy'));
    const satire = screen.getByTestId('match-mood-Satire');
    expect(screen.queryByTestId('match-mood-Power')).not.toBeInTheDocument(); // Drama mood hidden
    fireEvent.click(satire);
    expect(satire).toHaveAttribute('aria-pressed', 'true');
    expect(router.state.location.search).toContain('genre=Comedy&mood=Satire');
    fireEvent.click(screen.getByTestId('match-next'));
    await waitFor(() => expect(step()).toHaveAttribute('data-step', '4'));
  });

  it('answers with number keys and goes Back', async () => {
    const { router } = render('/match?kind=solo&range=Soprano&genre=any&step=4');
    fireEvent.keyDown(screen.getByTestId('match-len-short'), { key: '1' });
    expect(router.state.location.search).toContain('len=short');
    await waitFor(() => expect(step()).toHaveAttribute('data-step', '5'));
    fireEvent.click(screen.getByTestId('match-back'));
    await waitFor(() => expect(step()).toHaveAttribute('data-step', '4'));
  });

  it('lets the progress dots jump to answered questions', async () => {
    render('/match?kind=solo&range=Soprano&step=3');
    fireEvent.click(screen.getByRole('button', { name: /Question 1: Solo or duet \(answered\)/ }));
    await waitFor(() => expect(step()).toHaveAttribute('data-step', '1'));
    expect(screen.queryByRole('button', { name: /Question 5/ })).not.toBeInTheDocument(); // not reachable yet
  });
});

describe('MatchPage results', () => {
  const all = 'kind=solo&range=Soprano&genre=Comedy&mood=Satire&len=short&mature=no';

  it('ranks matches with a % badge and "why it matched" chips (mature songs filtered out)', () => {
    render(`/match?${all}&step=results`);
    const results = screen.getAllByTestId('match-result');
    expect(results.length).toBe(4); // Epiphany is mature → excluded
    expect(within(results[0]!).getByTestId('song-title')).toHaveTextContent('Popular');
    expect(within(results[0]!).getByTestId('match-percent')).toHaveTextContent('100% match');
    expect(within(results[0]!).getByLabelText('Why it matched')).toHaveTextContent('Written for Soprano');
    expect(screen.getByTestId('match-considered')).toHaveTextContent('We scored 4 songs');
    expect(screen.queryByText('Epiphany')).not.toBeInTheDocument();
    const percents = results.map((r) => Number(r.getAttribute('data-percent')));
    expect([...percents].sort((a, b) => b - a)).toEqual(percents);
  });

  it('summary chips jump back to a question; Restart clears everything', async () => {
    const { router } = render(`/match?${all}&step=results`);
    fireEvent.click(screen.getByTestId('match-summary-4'));
    await waitFor(() => expect(step()).toHaveAttribute('data-step', '4'));
    expect(screen.getByTestId('match-len-short')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('match-jump-results'));
    await waitFor(() => expect(screen.getByTestId('match-results')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('match-restart'));
    await waitFor(() => expect(step()).toHaveAttribute('data-step', '1'));
    expect(router.state.location.search).toBe('');
  });

  it('Refine goes back to question 1 keeping the answers', async () => {
    const { router } = render(`/match?${all}&step=results`);
    fireEvent.click(screen.getByTestId('match-refine'));
    await waitFor(() => expect(step()).toHaveAttribute('data-step', '1'));
    expect(router.state.location.search).toContain('kind=solo&range=Soprano');
    expect(screen.getByTestId('match-kind-solo')).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows a friendly empty state when nothing is left', () => {
    renderWithProviders(<MatchPage />, { route: '/match?mature=no&step=results', path: '/match', songs: [songs[3]!], meta: makeMeta() });
    expect(screen.getByTestId('empty-state')).toHaveTextContent('No matches this time');
  });
});
