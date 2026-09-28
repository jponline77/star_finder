/**
 * Building blocks of the song form: acts, the solo/duet label, the character counter, the part editor (with
 * catalog suggestion chips) and the loading skeleton.
 */
import type { ReactNode } from 'react';
import { Field } from '../../components/Controls';
import { Skeleton } from '../../components/Skeletons';
import { SuggestionChip, type ChipSuggestion } from '../../components/SuggestionChip';
import { initials } from '../../lib/hash';
import { equalsLoose } from '../../lib/normalize';
import { RANGE_INFO, normalizeVocalRange, rangeSlug, VOCAL_RANGES } from '../../lib/vocab';
import type { Kind } from '../../types';
import { CHARACTER_MAX, type PartValues } from './model';
import type { RangeSuggestion } from './suggestions';

export function FormAct({ num, title, emoji, id, subtitle, children }: { num: number; title: string; emoji: string; id: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <section className="form-act" aria-labelledby={`${id}-title`} id={id}>
      <div className="form-act-head">
        <span className="form-act-num" aria-hidden="true">
          {num}
        </span>
        <div>
          <p className="form-act-kicker" aria-hidden="true">
            Act {num}
          </p>
          <h2 id={`${id}-title`} className="form-act-title" tabIndex={-1}>
            <span className="visually-hidden">Act {num}: </span>
            {title}{' '}
            <span className="emoji" aria-hidden="true">
              {emoji}
            </span>
          </h2>
          {subtitle && <p className="hint">{subtitle}</p>}
        </div>
      </div>
      <div className="form-act-body">{children}</div>
    </section>
  );
}

export function KindLabel({ emoji, text, sub }: { emoji: string; text: string; sub: string }) {
  return (
    <span className="kind-label">
      <span className="emoji" aria-hidden="true">
        {emoji}
      </span>
      <span className="kind-label-text">
        {text}
        <span className="kind-label-sub">{sub}</span>
      </span>
    </span>
  );
}

export function CharCount({ value, max }: { value: string; max: number }) {
  const n = [...value].length;
  return (
    <span className={`char-counter${n > max ? ' is-over' : n > max * 0.9 ? ' is-near' : ''}`} aria-live={n > max * 0.9 ? 'polite' : undefined}>
      {n}/{max}
    </span>
  );
}

export function FormSkeleton({ label = 'Loading the song…' }: { label?: string }) {
  return (
    <div className="container song-form-page" role="status" aria-live="polite" data-testid="form-skeleton">
      <span className="visually-hidden">{label}</span>
      <div className="stack">
        <Skeleton height={16} width={120} />
        <Skeleton height={48} width="60%" radius={10} />
        <Skeleton height={120} radius={18} />
        <Skeleton height={220} radius={18} />
        <Skeleton height={180} radius={18} />
      </div>
    </div>
  );
}

export interface PartEditorProps {
  index: number;
  kind: Kind;
  part: PartValues;
  names: string[];
  autoFilled: boolean;
  characterError?: string;
  rangeError?: string;
  onCharacter: (value: string) => void;
  onRange: (value: string) => void;
  onBlur: () => void;
  /** Catalog suggestion for this part's character (with the other singers as alternatives). */
  characterSuggestion?: ChipSuggestion<string> | null;
  /** Pick a suggested character (also fills a known vocal range). */
  onPickCharacter?: (name: string) => void;
  /** Suggested vocal range for the character typed now. */
  rangeSuggestion?: RangeSuggestion | null;
}

export function PartEditor({
  index,
  kind,
  part,
  names,
  autoFilled,
  characterError,
  rangeError,
  onCharacter,
  onRange,
  onBlur,
  characterSuggestion,
  onPickCharacter,
  rangeSuggestion,
}: PartEditorProps) {
  const n = index + 1;
  const listId = `part-${n}-character-options`;
  const range = normalizeVocalRange(part.vocalRange);
  const info = range ? RANGE_INFO[range] : null;
  const who = part.character.trim() || (kind === 'duet' ? `part ${n}` : 'the character');
  const charSuggId = `part-${n}-character-suggestion`;
  const rangeSuggId = `part-${n}-range-suggestion`;
  const rangeFromCatalog = rangeSuggestion && equalsLoose(rangeSuggestion.value, part.vocalRange);
  return (
    <fieldset className={`part-card range-${rangeSlug(part.vocalRange)}`}>
      <legend className="part-card-legend">
        <span className="part-card-avatar" aria-hidden="true">
          {part.character.trim() ? initials(part.character) : n}
        </span>
        {kind === 'duet' ? `Part ${n}` : 'The character'}
      </legend>
      <Field label="Character" id={`part-${n}-character`} error={characterError} hint={names.length ? 'Pick a character from this show or type a new one.' : undefined}>
        {(p) => (
          <>
            <input
              className="input"
              id={p.id}
              aria-describedby={[p.describedBy, characterSuggestion ? charSuggId : null].filter(Boolean).join(' ') || undefined}
              aria-invalid={p.invalid || undefined}
              list={names.length ? listId : undefined}
              value={part.character}
              onChange={(e) => onCharacter(e.target.value)}
              onBlur={onBlur}
              maxLength={CHARACTER_MAX + 10}
              placeholder={kind === 'duet' ? (index === 0 ? 'e.g. Elphaba' : 'e.g. Glinda') : 'e.g. Elphaba'}
              autoComplete="off"
              data-testid={`part-${n}-character`}
            />
            {names.length > 0 && (
              <datalist id={listId}>
                {names.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            )}
            {characterSuggestion && (
              <SuggestionChip
                label={kind === 'duet' ? `character for part ${n}` : 'character'}
                suggestion={characterSuggestion}
                current={part.character}
                onApply={(name) => (onPickCharacter ? onPickCharacter(name) : onCharacter(name))}
                onClear={() => onCharacter('')}
                id={charSuggId}
                testId={`part-${n}-character-suggestion`}
              />
            )}
          </>
        )}
      </Field>
      <Field
        label="Vocal range"
        optional
        id={`part-${n}-range`}
        error={rangeError}
        hint={
          rangeFromCatalog
            ? info
              ? `${info.blurb} ${info.example}`
              : undefined
            : autoFilled && range
              ? `Filled in from other songs this character sings — change it if needed.`
              : info
                ? `${info.blurb} ${info.example}`
                : 'Not sure? Leave it — someone can add it later.'
        }
      >
        {(p) => (
          <>
            <select
              className="select"
              id={p.id}
              aria-describedby={[p.describedBy, rangeSuggestion ? rangeSuggId : null].filter(Boolean).join(' ') || undefined}
              aria-invalid={p.invalid || undefined}
              value={part.vocalRange}
              onChange={(e) => onRange(e.target.value)}
              data-testid={`part-${n}-range`}
            >
              <option value="">Not sure</option>
              {VOCAL_RANGES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            {rangeSuggestion && (
              <SuggestionChip
                label={`vocal range for ${who}`}
                suggestion={{ value: rangeSuggestion.value, source: rangeSuggestion.source, confidence: rangeSuggestion.confidence, alternatives: rangeSuggestion.alternatives }}
                current={part.vocalRange}
                onApply={onRange}
                onClear={() => onRange('')}
                id={rangeSuggId}
                testId={`part-${n}-range-suggestion`}
              />
            )}
          </>
        )}
      </Field>
    </fieldset>
  );
}
