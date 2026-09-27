import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/render';
import { makeComment, makeUser } from '../../test/fixtures';
import { CommentsSection } from '../CommentsSection';
import type { Comment } from '../../types';

const mine = makeComment({ id: 1, body: 'My tip', tag: 'tip', author: { id: 7, displayName: 'Stage Kid', role: 'user' } });
const theirs = makeComment({ id: 2, body: 'Their question', tag: 'question', author: { id: 9, displayName: 'Other Kid', role: 'user' }, edited: true });
const adminC = makeComment({ id: 3, body: 'Admin note', tag: 'general', author: { id: 1, displayName: 'Ms. Director', role: 'admin' } });

function mockApi(initial: Comment[]) {
  let comments = [...initial];
  const fn = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (method === 'GET' && url.endsWith('/comments')) return json(200, { comments });
    if (method === 'POST' && url.endsWith('/comments')) {
      const body = JSON.parse(String(init?.body)) as { body: string; tag: Comment['tag'] };
      const c = makeComment({ id: 99, body: body.body, tag: body.tag, author: { id: 7, displayName: 'Stage Kid', role: 'user' } });
      comments = [...comments, c];
      return json(201, c);
    }
    if (method === 'DELETE') {
      const id = Number(url.split('/').pop());
      comments = comments.filter((c) => c.id !== id);
      return json(204);
    }
    if (method === 'PATCH') {
      const id = Number(url.split('/').pop());
      const patch = JSON.parse(String(init?.body)) as Partial<Comment>;
      const c = { ...comments.find((x) => x.id === id)!, ...patch, edited: true };
      comments = comments.map((x) => (x.id === id ? c : x));
      return json(200, c);
    }
    return json(404, { error: 'nope' });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('CommentsSection', () => {
  it('lists comments with tags, admin badge and edited marker; logged-out users get a login prompt', async () => {
    mockApi([mine, theirs, adminC]);
    renderWithProviders(<CommentsSection target={{ type: 'song', id: 5 }} />, { route: '/songs/5' });
    expect(await screen.findAllByTestId('comment')).toHaveLength(3);
    expect(screen.getByText('Their question')).toBeInTheDocument();
    expect(screen.getAllByText(/edited/).length).toBeGreaterThan(0);
    expect(screen.getByText('Admin', { selector: '.badge *, .badge' })).toBeInTheDocument();
    expect(screen.getByTestId('comment-login-prompt')).toHaveTextContent('Log in to join the conversation');
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login?next=%2Fsongs%2F5%23comments');
    expect(screen.queryByTestId('comment-edit')).toBeNull();
    expect(screen.queryByTestId('comment-delete')).toBeNull();
  });

  it('lets a user post and only edit/delete their own comments', async () => {
    const fn = mockApi([mine, theirs]);
    renderWithProviders(<CommentsSection target={{ type: 'song', id: 5 }} />, { user: makeUser({ id: 7 }) });
    await screen.findAllByTestId('comment');
    const items = screen.getAllByTestId('comment');
    expect(within(items[0]!).getByTestId('comment-edit')).toBeInTheDocument();
    expect(within(items[1]!).queryByTestId('comment-edit')).toBeNull();
    expect(within(items[1]!).queryByTestId('comment-delete')).toBeNull();

    const input = screen.getByTestId('comment-input');
    expect(screen.getByTestId('comment-submit')).toBeDisabled();
    fireEvent.change(input, { target: { value: '  I performed this at regionals!  ' } });
    fireEvent.click(within(screen.getByTestId('comment-tag-performed')).getByRole('radio'));
    fireEvent.click(screen.getByTestId('comment-submit'));
    await waitFor(() => expect(screen.getAllByTestId('comment')).toHaveLength(3));
    const post = fn.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST');
    expect(JSON.parse(String((post![1] as RequestInit).body))).toEqual({ body: 'I performed this at regionals!', tag: 'performed' });
    expect(screen.getByTestId('comment-input')).toHaveValue('');
  });

  it('shows the 1000-character counter and blocks over-long comments', async () => {
    mockApi([]);
    renderWithProviders(<CommentsSection target={{ type: 'show', id: 'wicked' }} />, { user: makeUser() });
    await screen.findByText('Crickets in the wings…');
    fireEvent.change(screen.getByTestId('comment-input'), { target: { value: 'x'.repeat(1001) } });
    expect(screen.getByText('1001/1000')).toBeInTheDocument();
    expect(screen.getByTestId('comment-submit')).toBeDisabled();
  });

  it('admins can remove anyone’s comment after confirming', async () => {
    const fn = mockApi([theirs]);
    renderWithProviders(<CommentsSection target={{ type: 'song', id: 5 }} />, { user: makeUser({ id: 1, role: 'admin' }) });
    await screen.findAllByTestId('comment');
    fireEvent.click(screen.getByTestId('comment-delete'));
    fireEvent.click(await screen.findByTestId('confirm-button'));
    await waitFor(() => expect(screen.queryAllByTestId('comment')).toHaveLength(0));
    expect(fn.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'DELETE' && String(c[0]) === '/api/comments/2')).toBe(true);
  });

  it('counts emoji like the server (code points), so 600 emoji fit in 1000', async () => {
    mockApi([]);
    renderWithProviders(<CommentsSection target={{ type: 'song', id: 6 }} />, { user: makeUser() });
    await screen.findByText('Crickets in the wings…');
    fireEvent.change(screen.getByTestId('comment-input'), { target: { value: '🎤'.repeat(600) } });
    expect(screen.getByText('600/1000')).toBeInTheDocument();
    expect(screen.getByTestId('comment-submit')).toBeEnabled();
  });

  it('announces the length limit only when crossing a threshold, not on every keystroke', async () => {
    mockApi([]);
    renderWithProviders(<CommentsSection target={{ type: 'song', id: 6 }} />, { user: makeUser() });
    await screen.findByText('Crickets in the wings…');
    const counter = screen.getByText('0/1000');
    expect(counter.closest('[aria-live]')).toBeNull();
    const status = screen.getByTestId('comment-limit-status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    fireEvent.change(screen.getByTestId('comment-input'), { target: { value: 'x'.repeat(10) } });
    expect(status).toHaveTextContent('');
    fireEvent.change(screen.getByTestId('comment-input'), { target: { value: 'x'.repeat(950) } });
    const near = status.textContent;
    expect(near).toMatch(/characters or fewer left/);
    fireEvent.change(screen.getByTestId('comment-input'), { target: { value: 'x'.repeat(951) } });
    expect(status.textContent).toBe(near); // same text → nothing new to announce
    fireEvent.change(screen.getByTestId('comment-input'), { target: { value: 'x'.repeat(1001) } });
    expect(status).toHaveTextContent(/over the 1000-character limit/);
  });

  it('falls back to “All” when the active tag filter empties, instead of hiding the rest', async () => {
    const general = makeComment({ id: 4, body: 'General chat', tag: 'general', author: { id: 7, displayName: 'Stage Kid', role: 'user' } });
    mockApi([general, mine]);
    renderWithProviders(<CommentsSection target={{ type: 'song', id: 5 }} />, { user: makeUser({ id: 7 }) });
    await screen.findAllByTestId('comment');
    fireEvent.click(screen.getByTestId('comment-filter-tip'));
    expect(screen.getAllByTestId('comment')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('comment-delete'));
    fireEvent.click(await screen.findByTestId('confirm-button'));
    await waitFor(() => expect(screen.queryByText('My tip')).toBeNull());
    expect(screen.getAllByTestId('comment')).toHaveLength(1);
    expect(screen.getByText('General chat')).toBeInTheDocument();
    expect(screen.queryByTestId('comment-filter-all')).toBeNull();
    // the deleted comment's button is gone — focus lands on the section heading, not <body>
    await waitFor(() => expect(screen.getByRole('heading', { level: 2 })).toHaveFocus());
  });

  it('moves focus to the next comment after deleting one', async () => {
    const second = makeComment({ id: 4, body: 'Second tip', tag: 'tip', author: { id: 7, displayName: 'Stage Kid', role: 'user' } });
    mockApi([mine, second]);
    renderWithProviders(<CommentsSection target={{ type: 'song', id: 5 }} />, { user: makeUser({ id: 7 }) });
    await screen.findAllByTestId('comment');
    fireEvent.click(screen.getAllByTestId('comment-delete')[0]!);
    fireEvent.click(await screen.findByTestId('confirm-button'));
    await waitFor(() => expect(screen.getAllByTestId('comment')).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId('comment-edit')).toHaveFocus());
  });

  it('keeps an unsent comment when the session has ended, and restores it after logging back in', async () => {
    mockApi([]);
    const fn = vi.fn(async (_input: unknown, init?: RequestInit) =>
      (init?.method ?? 'GET') === 'GET'
        ? new Response(JSON.stringify({ comments: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        : new Response(JSON.stringify({ error: 'Please log in first' }), { status: 401, headers: { 'Content-Type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fn);
    const first = renderWithProviders(<CommentsSection target={{ type: 'song', id: 5 }} />, { route: '/songs/5', user: makeUser({ id: 7 }) });
    await screen.findByText('Crickets in the wings…');
    fireEvent.change(screen.getByTestId('comment-input'), { target: { value: 'A long tip about breathing' } });
    fireEvent.click(within(screen.getByTestId('comment-tag-tip')).getByRole('radio'));
    fireEvent.click(screen.getByTestId('comment-submit'));
    await waitFor(() => expect(first.router.state.location.pathname).toBe('/login'));
    expect(first.router.state.location.search).toBe('?next=%2Fsongs%2F5');
    first.unmount();

    mockApi([]);
    renderWithProviders(<CommentsSection target={{ type: 'song', id: 5 }} />, { route: '/songs/5', user: makeUser({ id: 7 }) });
    await screen.findByText('Crickets in the wings…');
    expect(screen.getByTestId('comment-input')).toHaveValue('A long tip about breathing');
    expect(within(screen.getByTestId('comment-tag-tip')).getByRole('radio')).toBeChecked();
    await act(async () => undefined);
    expect(Object.keys(window.sessionStorage).filter((k) => k.startsWith('star.draft'))).toEqual([]);
  });

  it('re-opens an interrupted comment edit after logging back in', async () => {
    const fn = vi.fn(async (_input: unknown, init?: RequestInit) =>
      (init?.method ?? 'GET') === 'GET'
        ? new Response(JSON.stringify({ comments: [mine] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        : new Response(JSON.stringify({ error: 'Please log in first' }), { status: 401, headers: { 'Content-Type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fn);
    const first = renderWithProviders(<CommentsSection target={{ type: 'song', id: 5 }} />, { route: '/songs/5', user: makeUser({ id: 7 }) });
    await screen.findAllByTestId('comment');
    fireEvent.click(screen.getByTestId('comment-edit'));
    fireEvent.change(screen.getAllByTestId('comment-input')[0]!, { target: { value: 'My tip, rewritten carefully' } });
    fireEvent.click(screen.getByTestId('comment-save'));
    await waitFor(() => expect(first.router.state.location.pathname).toBe('/login'));
    first.unmount();

    mockApi([mine]);
    renderWithProviders(<CommentsSection target={{ type: 'song', id: 5 }} />, { route: '/songs/5', user: makeUser({ id: 7 }) });
    expect(await screen.findByTestId('comment-save')).toBeInTheDocument();
    expect(screen.getAllByTestId('comment-input')[0]).toHaveValue('My tip, rewritten carefully');
  });

  it('edits a comment inline', async () => {
    mockApi([mine]);
    renderWithProviders(<CommentsSection target={{ type: 'song', id: 5 }} />, { user: makeUser({ id: 7 }) });
    await screen.findAllByTestId('comment');
    fireEvent.click(screen.getByTestId('comment-edit'));
    const inputs = screen.getAllByTestId('comment-input');
    fireEvent.change(inputs[0]!, { target: { value: 'Updated tip' } });
    fireEvent.click(screen.getByTestId('comment-save'));
    await waitFor(() => expect(screen.getByTestId('comment-body')).toHaveTextContent('Updated tip'));
    expect(screen.queryByTestId('comment-save')).toBeNull();
  });
});
