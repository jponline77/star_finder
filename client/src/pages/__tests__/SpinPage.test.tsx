import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/render';
import { makeMeta, makeSong, part } from '../../test/fixtures';
import SpinPage from '../SpinPage';

const confetti = vi.hoisted(() => vi.fn(() => () => {}));
vi.mock('../../components/Confetti', () => ({ fireConfetti: confetti, Confetti: () => null }));

const songs = [
  makeSong({ id: 1, title: 'Popular', kind: 'solo', parts: [part('Glinda', 'Soprano')] }),
  makeSong({ id: 2, title: 'Epiphany', kind: 'solo', mature: true, parts: [part('Sweeney', 'Baritone')] }),
  makeSong({ id: 3, title: 'A Heart Full of Love', kind: 'duet', parts: [part('Cosette', 'Soprano', 1), part('Marius', 'Tenor', 2)] }),
  makeSong({ id: 4, title: 'Bring Him Home', kind: 'solo', parts: [part('Valjean', 'Tenor')] }),
];

function mockReducedMotion(reduce: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: reduce && query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('SpinPage', () => {
  it('shows the pool size and narrows it with filters (kept in the URL)', () => {
    const { router } = renderWithProviders(<SpinPage />, { route: '/spin', path: '/spin', songs, meta: makeMeta() });
    expect(screen.getByTestId('spin-pool-size')).toHaveTextContent('4 songs in the hat');
    fireEvent.click(screen.getByTestId('spin-kind-solo'));
    expect(screen.getByTestId('spin-pool-size')).toHaveTextContent('3 songs in the hat');
    fireEvent.click(screen.getByTestId('spin-hide-mature'));
    expect(screen.getByTestId('spin-pool-size')).toHaveTextContent('2 songs in the hat');
    fireEvent.click(screen.getByTestId('spin-range-Tenor'));
    expect(screen.getByTestId('spin-pool-size')).toHaveTextContent('1 song in the hat');
    expect(router.state.location.search).toBe('?kind=solo&range=Tenor&hideMature=1');
    fireEvent.click(screen.getByTestId('spin-clear'));
    expect(screen.getByTestId('spin-pool-size')).toHaveTextContent('4 songs in the hat');
  });

  it('reads filters from the URL and disables the lever when the pool is empty', () => {
    renderWithProviders(<SpinPage />, { route: '/spin?kind=duet&range=Bass', path: '/spin', songs, meta: makeMeta() });
    expect(screen.getByTestId('spin-pool-size')).toHaveTextContent('No songs match these filters.');
    expect(screen.getByTestId('spin-button')).toBeDisabled();
  });

  it('with reduced motion, skips straight to the result (deterministic random) and "Spin again" lands somewhere new', () => {
    mockReducedMotion(true);
    renderWithProviders(<SpinPage random={() => 0} />, { route: '/spin?kind=solo', path: '/spin', songs, meta: makeMeta() });
    fireEvent.click(screen.getByTestId('spin-button'));
    const result = screen.getByTestId('spin-result');
    expect(result).toHaveAttribute('data-song-id', '1');
    expect(result).toHaveTextContent('Popular');
    expect(screen.getByTestId('spin-announcement')).toHaveTextContent('The spotlight lands on “Popular” from Wicked!');
    expect(screen.getByTestId('spin-open-song')).toHaveAttribute('href', '/songs/1');
    expect(confetti).toHaveBeenCalled();
    expect(screen.getByTestId('setlist-heart')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByTestId('spin-again'));
    expect(screen.getByTestId('spin-result')).toHaveAttribute('data-song-id', '2');
    expect(screen.getByText('Earlier spins')).toBeInTheDocument();
  });

  it('animates the reel with requestAnimationFrame and lands on the picked song', async () => {
    mockReducedMotion(false);
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    renderWithProviders(<SpinPage random={() => 0.99} />, { route: '/spin', path: '/spin', songs, meta: makeMeta() });
    fireEvent.click(screen.getByTestId('spin-button'));
    expect(screen.getByTestId('spin-button')).toBeDisabled();
    expect(screen.getByTestId('spin-button')).toHaveTextContent('Spinning…');
    expect(screen.queryByTestId('spin-result')).not.toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByTestId('spin-result')).toHaveAttribute('data-song-id', '4'));
    expect(screen.getByTestId('spin-button')).toHaveTextContent('Spin again');
    expect(screen.getByTestId('spin-reel')).toHaveClass('has-landed');
  });
});
