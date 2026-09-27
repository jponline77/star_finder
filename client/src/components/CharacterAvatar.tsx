import type { CSSProperties } from 'react';
import { gradientFor, initials } from '../lib/hash';
import { normalizeVocalRange, rangeSlug } from '../lib/vocab';

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface CharacterAvatarProps {
  name: string;
  /** Colours the disc; null/unknown → neutral */
  range?: string | null;
  size?: AvatarSize;
  className?: string;
  /** Include the range in the accessible label (default true). */
  labelRange?: boolean;
}

/** Initials disc coloured by vocal range (no photos of real performers). */
export function CharacterAvatar({ name, range, size = 'md', className = '', labelRange = true }: CharacterAvatarProps) {
  const r = normalizeVocalRange(range);
  const label = labelRange && r ? `${name} (${r})` : name;
  return (
    <span className={`avatar avatar-${size} range-${rangeSlug(range)} ${className}`.trim()} role="img" aria-label={label} title={label}>
      <span aria-hidden="true">{initials(name)}</span>
    </span>
  );
}

export interface UserAvatarProps {
  name: string;
  size?: AvatarSize;
  className?: string;
  /** decorative when the name is printed next to it (default) */
  decorative?: boolean;
}

/** Initials disc for a person (display name), coloured by a stable gradient. */
export function UserAvatar({ name, size = 'sm', className = '', decorative = true }: UserAvatarProps) {
  const style = { '--art-gradient': gradientFor(name).css } as CSSProperties;
  return (
    <span
      className={`avatar avatar-user avatar-${size} ${className}`.trim()}
      style={style}
      aria-hidden={decorative ? true : undefined}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
    >
      {initials(name)}
    </span>
  );
}
