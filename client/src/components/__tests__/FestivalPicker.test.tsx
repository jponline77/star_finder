import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { FESTIVAL_STORAGE_KEY } from '../../lib/festivals';
import { makeMeta } from '../../test/fixtures';
import { renderWithProviders } from '../../test/render';
import { FestivalChips, FestivalPicker } from '../FestivalPicker';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderPicker(ui = <FestivalPicker />, local?: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 27, 12));
  if (local) window.localStorage.setItem(FESTIVAL_STORAGE_KEY, local);
  return renderWithProviders(ui, { meta: makeMeta() });
}

const chip = () => screen.getByTestId('festival-picker');
const listbox = () => screen.getByRole('listbox', { name: 'Where are you performing?' });
const activeOption = () => document.getElementById(listbox().getAttribute('aria-activedescendant') ?? '');

describe('FestivalPicker (compact chip + listbox)', () => {
  it('is a labelled button that opens a grouped listbox with dates', () => {
    renderPicker();
    expect(chip()).toHaveAccessibleName('Choose your festival');
    expect(chip()).toHaveAttribute('aria-haspopup', 'listbox');
    expect(chip()).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(chip());
    expect(chip()).toHaveAttribute('aria-expanded', 'true');
    expect(chip()).toHaveAttribute('aria-controls', listbox().id);
    const groups = within(listbox()).getAllByRole('group');
    expect(groups.map((g) => g.getAttribute('aria-labelledby') && document.getElementById(g.getAttribute('aria-labelledby')!)?.textContent)).toEqual(['BC regional festivals', 'Online']);
    expect(within(groups[0]!).getAllByRole('option')).toHaveLength(7);
    expect(within(groups[0]!).getByRole('option', { name: 'Fraser Valley (Mission), Dec 4, 2026' })).toHaveTextContent('Fraser Valley · MissionDec 4, 2026');
    expect(within(groups[0]!).getByRole('option', { name: 'Nanaimo, Date to be announced' })).toBeInTheDocument();
    expect(within(groups[1]!).getByRole('option', { name: 'Online, Closes Feb 28, 2027' })).toBeInTheDocument();
    expect(listbox()).toHaveFocus();
  });

  it('shows the chosen festival, marks it selected and starts there', () => {
    renderPicker(undefined, 'victoria');
    expect(chip()).toHaveAccessibleName('Your festival: Victoria');
    fireEvent.click(chip());
    expect(screen.getByRole('option', { name: /Victoria/ })).toHaveAttribute('aria-selected', 'true');
    expect(activeOption()).toHaveTextContent('Victoria');
  });

  it('keyboard: arrows / Home / End move, Enter picks, focus returns to the chip', async () => {
    renderPicker();
    chip().focus();
    fireEvent.keyDown(chip(), { key: 'ArrowDown' });
    expect(activeOption()).toHaveTextContent('Prince George');
    fireEvent.keyDown(listbox(), { key: 'ArrowDown' });
    fireEvent.keyDown(listbox(), { key: 'ArrowDown' });
    expect(activeOption()).toHaveTextContent('Victoria');
    fireEvent.keyDown(listbox(), { key: 'End' });
    expect(activeOption()).toHaveTextContent('Online');
    fireEvent.keyDown(listbox(), { key: 'ArrowDown' }); // stays on the last one
    expect(activeOption()).toHaveTextContent('Online');
    fireEvent.keyDown(listbox(), { key: 'Home' });
    fireEvent.keyDown(listbox(), { key: 'ArrowUp' });
    expect(activeOption()).toHaveTextContent('Prince George');
    fireEvent.keyDown(listbox(), { key: 'ArrowDown' });
    fireEvent.keyDown(listbox(), { key: 'Enter' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(chip()).toHaveFocus();
    await waitFor(() => expect(chip()).toHaveAccessibleName('Your festival: Fraser Valley'));
    expect(window.localStorage.getItem(FESTIVAL_STORAGE_KEY)).toBe('fraser-valley');
    expect(await screen.findByText('Fraser Valley it is! Your countdown is set.')).toBeInTheDocument();
  });

  it('typing a letter jumps to the next festival starting with it', () => {
    renderPicker();
    fireEvent.click(chip());
    fireEvent.keyDown(listbox(), { key: 's' });
    expect(activeOption()).toHaveTextContent('Surrey');
    fireEvent.keyDown(listbox(), { key: 'o' }); // "so" — no match, stays
    expect(activeOption()).toHaveTextContent('Surrey');
  });

  it('Escape closes and returns focus; clicking outside closes', () => {
    renderPicker();
    fireEvent.click(chip());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(chip()).toHaveFocus();
    fireEvent.click(chip());
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('clicking an option picks it', async () => {
    renderPicker();
    fireEvent.click(chip());
    fireEvent.click(screen.getByRole('option', { name: /Burnaby/ }));
    await waitFor(() => expect(chip()).toHaveAccessibleName('Your festival: Burnaby'));
  });

  it('links to every date on STAR Prep', () => {
    renderPicker();
    fireEvent.click(chip());
    expect(screen.getByRole('link', { name: /All festival dates/ })).toHaveAttribute('href', '/star-prep#dates');
  });

  it('keyboard users reach that link: Tab from the list moves to it; leaving the popover closes it', () => {
    renderPicker(
      <>
        <FestivalPicker />
        <button type="button">After the picker</button>
      </>,
    );
    fireEvent.click(chip());
    expect(listbox()).toHaveFocus();
    const tab = fireEvent.keyDown(listbox(), { key: 'Tab' });
    expect(tab).toBe(false); // default prevented: focus is moved by the picker
    const more = screen.getByRole('link', { name: /All festival dates/ });
    expect(more).toHaveFocus();
    expect(screen.getByRole('listbox')).toBeInTheDocument(); // still open
    // Tab again: focus leaves the popover → it closes
    act(() => screen.getByRole('button', { name: 'After the picker' }).focus());
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(chip()).toHaveAttribute('aria-expanded', 'false');
  });

  it('Shift+Tab from the list closes it (focus goes back toward the chip)', () => {
    renderPicker();
    fireEvent.click(chip());
    fireEvent.keyDown(listbox(), { key: 'Tab', shiftKey: true });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('FestivalPicker variant="select"', () => {
  it('is a labelled native select with optgroups; changing it picks', async () => {
    renderPicker(<FestivalPicker variant="select" id="fest" />);
    const select = screen.getByLabelText('Your festival') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect([...select.querySelectorAll('optgroup')].map((g) => g.label)).toEqual(['BC regional festivals', 'Online']);
    expect(within(select).getByRole('option', { name: 'Surrey — Jan 29, 2027' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Fraser Valley (Mission) — Dec 4, 2026' })).toBeInTheDocument();
    expect(select.value).toBe('');
    fireEvent.change(select, { target: { value: 'online' } });
    await waitFor(() => expect(select.value).toBe('online'));
    expect(window.localStorage.getItem(FESTIVAL_STORAGE_KEY)).toBe('online');
  });

  it('inline: shows a summary and can be cleared', async () => {
    renderPicker(<FestivalPicker variant="inline" id="fest" label="My festival" />, 'surrey');
    expect(screen.getByTestId('festival-summary')).toHaveTextContent('Surrey Regional STAR Fest');
    expect(screen.getByTestId('festival-summary')).toHaveTextContent('Friday, January 29, 2027');
    expect(screen.getByTestId('festival-summary')).toHaveTextContent('North Surrey Secondary School');
    fireEvent.change(screen.getByLabelText('My festival'), { target: { value: '' } });
    await waitFor(() => expect(screen.queryByTestId('festival-summary')).toBeNull());
    expect(window.localStorage.getItem(FESTIVAL_STORAGE_KEY)).toBeNull();
  });
});

describe('FestivalChips', () => {
  it('one button per choice, the chosen one pressed', async () => {
    renderPicker(
      <>
        <h2 id="where">Where?</h2>
        <FestivalChips labelledBy="where" />
      </>,
      'vancouver',
    );
    const list = screen.getByRole('list', { name: 'Where?' });
    expect(within(list).getAllByRole('button')).toHaveLength(8);
    expect(screen.getByTestId('festival-chip-vancouver')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('festival-chip-nanaimo'));
    await waitFor(() => expect(screen.getByTestId('festival-chip-nanaimo')).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByTestId('festival-chip-vancouver')).toHaveAttribute('aria-pressed', 'false');
  });
});
