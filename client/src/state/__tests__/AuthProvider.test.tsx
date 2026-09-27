import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { postComment } from '../../api';
import { makeUser } from '../../test/fixtures';
import { renderWithProviders } from '../../test/render';
import { useAuth } from '../AuthProvider';

afterEach(() => vi.unstubAllGlobals());

function Poster() {
  const { user } = useAuth();
  return (
    <>
      <p data-testid="must-change">{String(user?.mustChangePassword)}</p>
      <button type="button" onClick={() => void postComment({ type: 'song', id: 1 }, { body: 'hi' }).catch(() => undefined)}>
        post
      </button>
    </>
  );
}

describe('AuthProvider: 403 MUST_CHANGE_PASSWORD', () => {
  it('marks the user and sends them to /me to choose a new password', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'Please choose a new password first', code: 'MUST_CHANGE_PASSWORD' }), { status: 403, headers: { 'Content-Type': 'application/json' } })),
    );
    const { router } = renderWithProviders(<Poster />, { route: '/songs/1', path: '/songs/:id', user: makeUser({ mustChangePassword: false }) });
    expect(screen.getByTestId('must-change')).toHaveTextContent('false');
    fireEvent.click(screen.getByRole('button', { name: 'post' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/me'));
    expect(await screen.findByText(/choose a new password first/i)).toBeInTheDocument();
  });

  it('a plain 403 (not yours to edit) does not redirect', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'You can only edit songs you added' }), { status: 403, headers: { 'Content-Type': 'application/json' } })),
    );
    const { router } = renderWithProviders(<Poster />, { route: '/songs/1', path: '/songs/:id', user: makeUser() });
    fireEvent.click(screen.getByRole('button', { name: 'post' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(router.state.location.pathname).toBe('/songs/1');
  });
});
