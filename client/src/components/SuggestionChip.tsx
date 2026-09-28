/**
 * A pre-filled field's suggestion (SPEC §7c): where the value came from and how sure we are, one-tap
 * alternatives, and an easy "Clear". Stays visible after the student edits the field, so a suggestion is
 * never lost — it just switches to "Suggested: X · Use it".
 *
 *   <SuggestionChip label="song title" suggestion={{ value, source, confidence, alternatives }}
 *     current={values.title} onApply={(v) => set(v)} onClear={() => set('')} id="title-suggestion" />
 *
 * Point the field's aria-describedby at `id` — it holds a full sentence for screen readers
 * ("Suggested from the Wikipedia song list, high confidence.").
 *
 * data-testids (with testId="x"): x, x-apply, x-clear, x-alt.
 */
import { RotateCcw, X } from 'lucide-react';
import type { Confidence } from '../types';
import { CONFIDENCE_LEVEL, CONFIDENCE_WORD, suggestionSentence } from '../lib/catalog';
import './catalog.css';

export interface ChipSuggestion<T> {
  value: T;
  source: string;
  confidence?: Confidence | null;
  note?: string | null;
  alternatives?: readonly T[];
}

export interface SuggestionChipProps<T> {
  /** What the field is (for screen readers): "song title", "vocal range for Jean Valjean"… */
  label: string;
  suggestion: ChipSuggestion<T>;
  /** The field's value right now. */
  current: T;
  onApply: (value: T) => void;
  /** Empties the field. Omit when the field can't be empty (e.g. a switch). */
  onClear?: () => void;
  format?: (value: T) => string;
  equals?: (a: T, b: T) => boolean;
  /** id of the screen-reader sentence (use it in the field's aria-describedby). */
  id?: string;
  testId?: string;
  className?: string;
}

const defaultFormat = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const defaultEquals = (a: unknown, b: unknown) => defaultFormat(a).trim().toLowerCase() === defaultFormat(b).trim().toLowerCase();

/**
 * ●●● sure / ●●○ pretty sure / ●○○ a guess — how sure a suggestion is, in plain words (a bare "high" next to a
 * vocal range reads like a high voice). Screen readers get "<level> confidence" from the chip's sentence.
 */
export function ConfidenceMeter({ confidence }: { confidence: Confidence }) {
  const level = CONFIDENCE_LEVEL[confidence];
  return (
    <span className={`confidence is-${confidence}`} title={`${confidence[0]!.toUpperCase()}${confidence.slice(1)} confidence`} data-confidence={confidence}>
      <span className="confidence-dots" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <span key={n} className={n <= level ? 'is-on' : undefined} />
        ))}
      </span>
      {CONFIDENCE_WORD[confidence]}
    </span>
  );
}

export function SuggestionChip<T>({
  label,
  suggestion,
  current,
  onApply,
  onClear,
  format = defaultFormat,
  equals = defaultEquals,
  id,
  testId,
  className = '',
}: SuggestionChipProps<T>) {
  const { value, source, confidence, note } = suggestion;
  const shown = format(value);
  const applied = equals(current, value);
  const empty = format(current).trim() === '';
  const state = applied ? 'applied' : empty ? 'cleared' : 'changed';
  const alternatives = (suggestion.alternatives ?? []).filter((a, i, all) => !equals(a, value) && all.findIndex((b) => equals(a, b)) === i && format(a).trim() !== '');
  const sentence = `${state === 'applied' ? suggestionSentence(source, confidence) : `${suggestionSentence(source, confidence)}: ${shown}`}.${
    note ? ` ${note}` : ''
  }`;

  return (
    <div className={`suggestion is-${state} ${className}`.trim()} role="group" aria-label={`Suggestion for ${label}`} data-testid={testId} data-state={state}>
      <div className="suggestion-line">
        <span id={id} className="visually-hidden">
          {sentence}
        </span>
        <span className="suggestion-text" aria-hidden="true">
          <span className="suggestion-spark">✨</span>
          {state === 'applied' ? (
            <span className="suggestion-source">{source}</span>
          ) : (
            <span>
              Suggested: <strong className="suggestion-value">{shown}</strong> <span className="suggestion-source">{source}</span>
            </span>
          )}
          {confidence && (
            <>
              <span className="suggestion-dot">·</span>
              <ConfidenceMeter confidence={confidence} />
            </>
          )}
        </span>
        {state === 'applied'
          ? onClear && (
              <button type="button" className="suggestion-action" onClick={onClear} aria-label={`Clear the suggested ${label}`} data-testid={testId ? `${testId}-clear` : undefined}>
                <X size={14} aria-hidden="true" /> Clear
              </button>
            )
          : (
              <button
                type="button"
                className="suggestion-action is-apply"
                onClick={() => onApply(value)}
                aria-label={`Use the suggested ${label}: ${shown}`}
                data-testid={testId ? `${testId}-apply` : undefined}
              >
                <RotateCcw size={14} aria-hidden="true" /> Use it
              </button>
            )}
      </div>
      {alternatives.length > 0 && (
        <div className="suggestion-alts">
          <span className="suggestion-alts-label" aria-hidden="true">
            Or:
          </span>
          <ul className="suggestion-alt-list" role="list" aria-label={`Other suggestions for ${label}`}>
            {alternatives.map((alt) => {
              const text = format(alt);
              const on = equals(current, alt);
              return (
                <li key={text}>
                  <button type="button" className="chip suggestion-alt" aria-pressed={on} onClick={() => onApply(alt)} data-testid={testId ? `${testId}-alt` : undefined}>
                    {text}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {note && (
        <p className="suggestion-note" aria-hidden="true">
          {note}
        </p>
      )}
    </div>
  );
}
