/**
 * "Not sure?" explainer for the six voice types, in teen-friendly words (Matchmaker step 2).
 */
import { HelpCircle } from 'lucide-react';
import { RangeBadge } from '../../components/RangeBadge';
import { RANGE_INFO, VOCAL_RANGES } from '../../lib/vocab';
import type { VocalRange } from '../../types';

const TEEN_WORDS: Record<VocalRange, string> = {
  Soprano: 'The highest voice. High notes feel light and floaty, and you can sail up there without shouting.',
  'Mezzo-soprano': 'Middle-high, with a strong, bright belt. Lots of pop singers live here.',
  Alto: 'The lowest of the higher voices. Warm and rich, and you feel strongest in your lower notes.',
  Tenor: 'The highest of the lower voices. You can go up high without straining, and it sounds bright and ringing.',
  Baritone: 'The middle of the lower voices, and the most common. Warm and flexible, and comfy right in the middle.',
  Bass: 'The deepest voice. Low notes rumble and feel easy, and high notes feel like a stretch.',
};

export function VoiceHelper() {
  return (
    <details className="match-helper" data-testid="voice-helper">
      <summary>
        <HelpCircle size={18} aria-hidden="true" />
        Not sure what your voice type is?
      </summary>
      <div className="match-helper-body">
        <p className="match-helper-tip">
          <strong>Quick test:</strong> sing “Happy Birthday” low, then again a few notes higher. Notice where it feels easy and where it starts to strain. Your
          voice might still be changing, and that’s totally normal. Pick what feels comfy <em>today</em>, or ask your choir or voice teacher.
        </p>
        <ul className="match-helper-list" role="list">
          {VOCAL_RANGES.map((r) => (
            <li key={r}>
              <RangeBadge range={r} variant="full" />
              <p>
                {TEEN_WORDS[r]} <span className="muted">{RANGE_INFO[r].example}</span>
              </p>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
