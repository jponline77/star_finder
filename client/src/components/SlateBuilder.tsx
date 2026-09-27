/**
 * Slate Builder (SPEC §1, §7.3, §7.9): name(s), school, troupe # → live slate text + copy button.
 * Performer details are real names, so they stay in this tab only unless the student ticks
 * "Remember on this device"; "Clear" (and logging out) forgets them. See lib/slate.ts.
 *
 *   <SlateBuilder kind={song.kind} title={song.title} show={song.show.name}
 *                 composer={show.composer} lyricist={show.lyricist} />      // song page
 *   <SlateBuilder />                                                       // STAR Prep (generic: kind toggle + title/show inputs)
 */
import { Eraser } from 'lucide-react';
import { useEffect, useId, useState, type ChangeEvent } from 'react';
import type { Kind } from '../types';
import { buildSlate, EMPTY_SLATE_DETAILS, forgetSlateDetails, loadSlateDetails, saveSlateDetails, type SlateDetails } from '../lib/slate';
import { CopyButton } from './CopyButton';
import { SegmentedControl, Switch } from './Controls';

export interface SlateBuilderProps {
  /** Fixed kind; omit for a Solo/Duet toggle. */
  kind?: Kind;
  /** Fixed song info; omit title/show to show inputs for them. */
  title?: string;
  show?: string;
  composer?: string | null;
  lyricist?: string | null;
  className?: string;
}

export function SlateBuilder({ kind: fixedKind, title: fixedTitle, show: fixedShow, composer, lyricist, className = '' }: SlateBuilderProps) {
  const id = useId();
  const [initial] = useState(loadSlateDetails);
  const [saved, setSaved] = useState<SlateDetails>(initial.details);
  const [remember, setRemember] = useState(initial.remembered);
  const [kind, setKind] = useState<Kind>(fixedKind ?? 'solo');
  const [title, setTitle] = useState('');
  const [show, setShow] = useState('');
  const [credits, setCredits] = useState('');
  const effectiveKind = fixedKind ?? kind;
  const hasDetails = Object.values(saved).some((v) => v.trim() !== '');

  useEffect(() => {
    saveSlateDetails(saved, remember);
  }, [saved, remember]);

  const clearDetails = () => {
    forgetSlateDetails();
    setSaved(EMPTY_SLATE_DETAILS);
    setRemember(false);
    // the Clear button disappears with the details — keep keyboard focus in the form
    document.getElementById(`${id}-n1`)?.focus();
  };

  const generic = fixedTitle === undefined;
  const result = buildSlate({
    kind: effectiveKind,
    names: effectiveKind === 'duet' ? [saved.name1, saved.name2] : [saved.name1],
    school: saved.school,
    troupe: saved.troupe,
    title: fixedTitle ?? title,
    show: fixedShow ?? show,
    composer: generic ? credits : composer,
    lyricist: generic ? credits : lyricist,
  });
  const set = (k: keyof SlateDetails) => (e: ChangeEvent<HTMLInputElement>) => setSaved((s) => ({ ...s, [k]: e.target.value }));

  return (
    <div className={`slate-builder ${className}`.trim()} data-testid="slate-builder">
      {!fixedKind && (
        <SegmentedControl<Kind>
          label="Solo or duet"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'solo', label: '🎤 Solo', testId: 'slate-kind-solo' },
            { value: 'duet', label: '👯 Duet', testId: 'slate-kind-duet' },
          ]}
        />
      )}
      <div className="slate-fields">
        <div className="field">
          <label className="label" htmlFor={`${id}-n1`}>
            {effectiveKind === 'duet' ? 'Performer 1' : 'Your name'}
          </label>
          <input id={`${id}-n1`} className="input" value={saved.name1} onChange={set('name1')} autoComplete="name" data-testid="slate-name" />
        </div>
        {effectiveKind === 'duet' && (
          <div className="field">
            <label className="label" htmlFor={`${id}-n2`}>
              Performer 2
            </label>
            <input id={`${id}-n2`} className="input" value={saved.name2} onChange={set('name2')} data-testid="slate-name-2" />
          </div>
        )}
        <div className="field">
          <label className="label" htmlFor={`${id}-school`}>
            School
          </label>
          <input id={`${id}-school`} className="input" value={saved.school} onChange={set('school')} data-testid="slate-school" />
        </div>
        <div className="field">
          <label className="label" htmlFor={`${id}-troupe`}>
            Troupe # <span className="optional">(optional)</span>
          </label>
          <input id={`${id}-troupe`} className="input" inputMode="numeric" value={saved.troupe} onChange={set('troupe')} data-testid="slate-troupe" />
        </div>
        {generic && (
          <>
            <div className="field">
              <label className="label" htmlFor={`${id}-title`}>
                Song title
              </label>
              <input id={`${id}-title`} className="input" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="slate-title" />
            </div>
            <div className="field">
              <label className="label" htmlFor={`${id}-show`}>
                Show
              </label>
              <input id={`${id}-show`} className="input" value={show} onChange={(e) => setShow(e.target.value)} data-testid="slate-show" />
            </div>
            <div className="field">
              <label className="label" htmlFor={`${id}-credits`}>
                Written by <span className="optional">(composer &amp; lyricist)</span>
              </label>
              <input id={`${id}-credits`} className="input" value={credits} onChange={(e) => setCredits(e.target.value)} placeholder="e.g. Stephen Schwartz" data-testid="slate-credits" />
            </div>
          </>
        )}
      </div>
      <div className="slate-privacy">
        <Switch checked={remember} onChange={setRemember} label="Remember my details on this device" testId="slate-remember" />
        {hasDetails && (
          <button type="button" className="btn btn-quiet btn-sm" onClick={clearDetails} data-testid="slate-clear">
            <Eraser size={15} aria-hidden="true" /> Clear my details
          </button>
        )}
        <p className="small muted slate-privacy-note">
          {remember ? 'Saved in this browser until you clear them or log out — skip this on a shared computer.' : 'Kept in this tab only — nothing is sent to the site.'}
        </p>
      </div>
      <figure className="slate-output">
        <figcaption className="eyebrow">Your slate</figcaption>
        <blockquote className="slate-text" data-testid="slate-text">
          “{result.slate}”
        </blockquote>
        <p className="slate-closing">
          <span aria-hidden="true">🎶 </span>
          {result.instruction}
        </p>
        <CopyButton text={result.text} label="Copy slate" size="sm" testId="slate-copy" />
      </figure>
    </div>
  );
}
