import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/render';
import { makeSong, makeUser } from '../../test/fixtures';
import { SlateBuilder } from '../SlateBuilder';
import { TimeLimitBar } from '../TimeLimitBar';
import { Countdown } from '../Countdown';
import { AddedBy, OwnerControls } from '../Ownership';

describe('SlateBuilder', () => {
  it('builds a live slate for a song and remembers the performer', () => {
    renderWithProviders(<SlateBuilder kind="solo" title="Popular" show="Wicked" composer="Stephen Schwartz" lyricist="Stephen Schwartz" />);
    fireEvent.change(screen.getByTestId('slate-name'), { target: { value: 'Heather Black' } });
    fireEvent.change(screen.getByTestId('slate-school'), { target: { value: 'Canada Junior High School' } });
    fireEvent.change(screen.getByTestId('slate-troupe'), { target: { value: '#1000' } });
    expect(screen.getByTestId('slate-text')).toHaveTextContent(
      `I am Heather Black from Canada Junior High School, Troupe #1000, and I'll be performing "Popular" from Wicked by Stephen Schwartz.`,
    );
    expect(screen.getByTestId('slate-builder')).toHaveTextContent('Thank you.');
    // remembered for this tab only — real names never land in localStorage unless the student opts in
    expect(JSON.parse(window.sessionStorage.getItem('star.slate.session.v1')!)).toMatchObject({ name1: 'Heather Black', troupe: '#1000' });
    expect(window.localStorage.length).toBe(0);
  });
  it('keeps performer details on the device only when asked, and Clear forgets them', () => {
    window.localStorage.setItem('star.slate.v1', JSON.stringify({ name1: 'Old Student', school: 'Old School' }));
    const { unmount } = renderWithProviders(<SlateBuilder kind="solo" title="Popular" show="Wicked" />);
    // details saved by older builds without consent are dropped, not pre-filled
    expect(screen.getByTestId('slate-name')).toHaveValue('');
    expect(window.localStorage.getItem('star.slate.v1')).toBeNull();
    fireEvent.change(screen.getByTestId('slate-name'), { target: { value: 'Heather Black' } });
    fireEvent.click(screen.getByTestId('slate-remember'));
    expect(JSON.parse(window.localStorage.getItem('star.slate.remembered.v1')!)).toMatchObject({ name1: 'Heather Black' });
    unmount();

    window.sessionStorage.clear(); // a new tab
    renderWithProviders(<SlateBuilder kind="solo" title="Popular" show="Wicked" />);
    expect(screen.getByTestId('slate-name')).toHaveValue('Heather Black');
    expect(screen.getByTestId('slate-remember')).toBeChecked();
    fireEvent.click(screen.getByTestId('slate-clear'));
    expect(screen.getByTestId('slate-name')).toHaveValue('');
    expect(screen.getByTestId('slate-name')).toHaveFocus();
    expect(screen.getByTestId('slate-remember')).not.toBeChecked();
    expect(window.localStorage.getItem('star.slate.remembered.v1')).toBeNull();
  });
  it('does not re-announce the whole slate on every keystroke', () => {
    renderWithProviders(<SlateBuilder kind="solo" title="Popular" show="Wicked" />);
    expect(screen.getByTestId('slate-text')).not.toHaveAttribute('aria-live');
    expect(screen.getByTestId('slate-text').closest('[aria-live]')).toBeNull();
  });
  it('generic mode offers solo/duet and song inputs', () => {
    renderWithProviders(<SlateBuilder />);
    fireEvent.click(screen.getByTestId('slate-kind-duet'));
    fireEvent.change(screen.getByTestId('slate-name'), { target: { value: 'Lee Jones' } });
    fireEvent.change(screen.getByTestId('slate-name-2'), { target: { value: 'Sam Becker' } });
    fireEvent.change(screen.getByTestId('slate-title'), { target: { value: 'Anything You Can Do' } });
    expect(screen.getByTestId('slate-text')).toHaveTextContent(/^“Our names are Lee Jones and Sam Becker from \[Your school\], and we'll be performing "Anything You Can Do" from \[Show\]\.”$/);
  });
});

describe('TimeLimitBar', () => {
  it('describes the length vs 6:00 as text', () => {
    renderWithProviders(<TimeLimitBar seconds={375} />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', expect.stringContaining('6:15 of 6:00'));
    expect(screen.getByTestId('time-limit-bar')).toHaveClass('is-over');
  });
});

describe('ownership', () => {
  const mine = makeSong({ source: 'community', createdBy: { id: 7, displayName: 'Stage Kid' } });
  it('shows Added by / From the spreadsheet', () => {
    renderWithProviders(
      <>
        <AddedBy item={mine} />
        <AddedBy item={makeSong()} />
      </>,
    );
    expect(screen.getAllByTestId('added-by').map((e) => e.textContent)).toEqual(['Added by Stage Kid', 'From the STAR spreadsheet']);
  });
  it('renders Edit/Delete only for the owner or an admin', () => {
    const { unmount } = renderWithProviders(<OwnerControls item={mine} editTo="/songs/1/edit" onDelete={() => undefined} />, { user: makeUser({ id: 8 }) });
    expect(screen.queryByTestId('edit-button')).toBeNull();
    unmount();
    renderWithProviders(<OwnerControls item={mine} editTo="/songs/1/edit" onDelete={() => undefined} />, { user: makeUser({ id: 7 }) });
    expect(screen.getByTestId('edit-button')).toHaveAttribute('href', '/songs/1/edit');
    expect(screen.getByTestId('delete-button')).toBeInTheDocument();
  });
  it('lets admins edit spreadsheet rows', () => {
    renderWithProviders(<OwnerControls item={makeSong()} editTo="/songs/1/edit" />, { user: makeUser({ role: 'admin' }) });
    expect(screen.getByTestId('edit-button')).toBeInTheDocument();
    expect(screen.queryByTestId('delete-button')).toBeNull();
  });
});

describe('Countdown', () => {
  afterEach(() => vi.useRealTimers());
  it('says “showtime” only on the festival day, and “that’s a wrap” afterwards', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 11, 11, 10));
    const { unmount } = renderWithProviders(<Countdown date="2026-12-11" />);
    expect(screen.getByTestId('countdown')).toHaveTextContent('It’s showtime! Break a leg!');
    unmount();
    vi.setSystemTime(new Date(2027, 0, 10, 10));
    renderWithProviders(<Countdown date="2026-12-11" />);
    expect(screen.getByTestId('countdown')).toHaveTextContent('That’s a wrap for 2026 — see you next season!');
    expect(screen.getByTestId('countdown')).not.toHaveTextContent('showtime');
  });
  it('deadline mode counts to the END of the closing day, then says submissions closed', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2027, 1, 28, 21, 30));
    const { unmount } = renderWithProviders(<Countdown date="2027-02-28" deadline label="Online Regional STAR Fest" />);
    expect(screen.getByTestId('countdown')).toHaveTextContent(/0days02hrs30min/);
    expect(screen.getByTestId('countdown')).toHaveTextContent('until Online Regional STAR Fest closes at the end of Sunday, February 28, 2027');
    unmount();
    vi.setSystemTime(new Date(2027, 2, 1, 0, 5));
    renderWithProviders(<Countdown date="2027-02-28" deadline />);
    expect(screen.getByTestId('countdown')).toHaveTextContent('Submissions closed');
    expect(screen.getByTestId('countdown')).not.toHaveTextContent('showtime');
  });
});
