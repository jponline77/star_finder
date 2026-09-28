import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { SuggestionChip, type ChipSuggestion } from '../SuggestionChip';

const suggestion: ChipSuggestion<string> = {
  value: 'Tenor',
  source: 'from 3 other Les Misérables songs on the site',
  confidence: 'high',
  alternatives: ['Baritone', 'Tenor', 'Bass', 'baritone'],
  note: 'One song says Baritone.',
};

function Harness({ initial = 'Tenor', onClear = true }: { initial?: string; onClear?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <select aria-label="Vocal range" aria-describedby="range-sugg" value={value} onChange={(e) => setValue(e.target.value)}>
        {['', 'Tenor', 'Baritone', 'Bass'].map((v) => (
          <option key={v} value={v}>
            {v || 'Not sure'}
          </option>
        ))}
      </select>
      <SuggestionChip label="vocal range" suggestion={suggestion} current={value} onApply={setValue} onClear={onClear ? () => setValue('') : undefined} id="range-sugg" testId="range" />
    </>
  );
}

describe('SuggestionChip', () => {
  it('shows where the value came from and how sure we are, and describes the field for screen readers', () => {
    render(<Harness />);
    const chip = screen.getByTestId('range');
    expect(chip).toHaveAttribute('data-state', 'applied');
    expect(chip).toHaveAccessibleName('Suggestion for vocal range');
    expect(chip).toHaveTextContent('from 3 other Les Misérables songs on the site');
    // plain words next to the dots — a bare "high" next to a vocal range reads like a high voice
    expect(chip.querySelector('.confidence')).toHaveTextContent(/^sure$/);
    expect(chip.querySelector('.confidence')).toHaveAttribute('title', 'High confidence');
    expect(screen.getByRole('combobox', { name: 'Vocal range' })).toHaveAccessibleDescription(
      'Suggested from 3 other Les Misérables songs on the site, high confidence. One song says Baritone.',
    );
  });

  it('Clear empties the field; the suggestion stays and "Use it" brings it back', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear the suggested vocal range' }));
    expect(screen.getByRole('combobox', { name: 'Vocal range' })).toHaveValue('');
    const chip = screen.getByTestId('range');
    expect(chip).toHaveAttribute('data-state', 'cleared');
    expect(chip).toHaveTextContent('Suggested: Tenor');
    fireEvent.click(screen.getByRole('button', { name: 'Use the suggested vocal range: Tenor' }));
    expect(screen.getByRole('combobox', { name: 'Vocal range' })).toHaveValue('Tenor');
  });

  it('changing the field by hand keeps the suggestion one tap away', () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Vocal range' }), { target: { value: 'Bass' } });
    expect(screen.getByTestId('range')).toHaveAttribute('data-state', 'changed');
    expect(screen.getByTestId('range-apply')).toHaveTextContent('Use it');
  });

  it('alternatives are one-tap chips (deduplicated, never the suggestion itself), pressed when chosen', () => {
    render(<Harness />);
    const list = screen.getByRole('list', { name: 'Other suggestions for vocal range' });
    const alts = within(list).getAllByRole('button');
    expect(alts.map((b) => b.textContent)).toEqual(['Baritone', 'Bass']);
    fireEvent.click(alts[0]!);
    expect(screen.getByRole('combobox', { name: 'Vocal range' })).toHaveValue('Baritone');
    expect(within(list).getByRole('button', { name: 'Baritone' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(list).getByRole('button', { name: 'Bass' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('booleans: custom wording, no Clear', () => {
    const onApply = vi.fn();
    render(
      <SuggestionChip
        label="mature themes flag"
        suggestion={{ value: true, source: 'from 2 other songs', confidence: 'medium' }}
        current={false}
        onApply={onApply}
        format={(v) => (v ? 'Mature themes' : 'No mature themes')}
        equals={(a, b) => a === b}
        testId="mature"
      />,
    );
    expect(screen.getByTestId('mature')).toHaveTextContent('Suggested: Mature themes');
    expect(screen.queryByRole('button', { name: /Clear/ })).toBeNull();
    fireEvent.click(screen.getByTestId('mature-apply'));
    expect(onApply).toHaveBeenCalledWith(true);
  });

  it('medium and low confidence read "pretty sure" and "a guess"', () => {
    const { rerender } = render(<SuggestionChip label="vocal range" suggestion={{ ...suggestion, confidence: 'medium' }} current="Tenor" onApply={() => undefined} testId="r" />);
    expect(screen.getByTestId('r').querySelector('.confidence')).toHaveTextContent(/^pretty sure$/);
    expect(screen.getByTestId('r').querySelector('.suggestion-text')).not.toHaveTextContent(/medium/); // visible text
    expect(screen.getByTestId('r')).toHaveTextContent(/medium confidence/); // the screen-reader sentence still says it
    rerender(<SuggestionChip label="vocal range" suggestion={{ ...suggestion, confidence: 'low' }} current="Tenor" onApply={() => undefined} testId="r" />);
    expect(screen.getByTestId('r').querySelector('.confidence')).toHaveTextContent(/^a guess$/);
  });
});
