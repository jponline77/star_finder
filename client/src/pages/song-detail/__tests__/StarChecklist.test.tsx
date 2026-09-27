import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render';
import { makeShow, makeSong } from '../../../test/fixtures';
import { StarChecklist } from '../StarChecklist';

function licensingItem(show: ReturnType<typeof makeShow>) {
  renderWithProviders(<StarChecklist song={makeSong({ lengthSeconds: 200 })} show={show} showLoading={false} showFailed={false} />);
  return screen.getByTestId('check-licensing');
}

describe('StarChecklist licensing', () => {
  it('is green only for an approved licensor with no caveat', () => {
    const item = licensingItem(makeShow({ licensor: 'Music Theatre International (MTI)', licensingNote: null }));
    expect(item).toHaveAttribute('data-status', 'ok');
    expect(within(item).getByRole('img')).toHaveAccessibleName('Looks good');
  });

  it('asks the student to check when the licensing note has a caveat (e.g. a play, not a musical)', () => {
    const item = licensingItem(
      makeShow({
        licensor: 'Concord Theatricals (Samuel French)',
        licensingNote: 'This is a play with music, not a musical, and no vocal score is listed.',
      }),
    );
    expect(item).toHaveAttribute('data-status', 'warn');
    expect(within(item).getByRole('img')).toHaveAccessibleName('Check this');
    expect(item).toHaveTextContent('Licensed by Concord Theatricals (Samuel French) — read the note');
    expect(item).toHaveTextContent('play with music');
  });

  it('flags a licensor that is not on STAR’s approved list', () => {
    const item = licensingItem(makeShow({ licensor: 'Some Other Agency', licensingNote: null }));
    expect(item).toHaveAttribute('data-status', 'warn');
    expect(item).toHaveTextContent('not on STAR’s approved list');
  });
});
