import { Link } from 'react-router';
import type { Kind } from '../types';
import { browseHref } from '../lib/filters';
import { genreEmoji, KIND_EMOJI, KIND_LABEL, subGenreEmoji } from '../lib/vocab';

interface TagProps {
  /** When true, renders a link to /songs filtered by this value. */
  link?: boolean;
  className?: string;
}

/** Genre tag with emoji (Comedy 😂, Drama 🎭, Romantic 💘, fallback 🎵). Renders nothing for null. */
export function GenreTag({ genre, link = false, className = '' }: TagProps & { genre: string | null | undefined }) {
  if (!genre) return null;
  const content = (
    <>
      <span className="emoji" aria-hidden="true">
        {genreEmoji(genre)}
      </span>
      {genre}
    </>
  );
  return link ? (
    <Link className={`tag tag-genre ${className}`.trim()} to={browseHref({ genres: [genre] })}>
      {content}
    </Link>
  ) : (
    <span className={`tag tag-genre ${className}`.trim()}>{content}</span>
  );
}

/** Sub-genre ("mood") tag with emoji (fallback ✨). Renders nothing for null. */
export function SubGenreTag({ subGenre, link = false, className = '' }: TagProps & { subGenre: string | null | undefined }) {
  if (!subGenre) return null;
  const content = (
    <>
      <span className="emoji" aria-hidden="true">
        {subGenreEmoji(subGenre)}
      </span>
      {subGenre}
    </>
  );
  return link ? (
    <Link className={`tag tag-subgenre ${className}`.trim()} to={browseHref({ subGenres: [subGenre] })}>
      {content}
    </Link>
  ) : (
    <span className={`tag tag-subgenre ${className}`.trim()}>{content}</span>
  );
}

/** "🎤 Solo" / "👯 Duet" tag. */
export function KindTag({ kind, link = false, className = '' }: TagProps & { kind: Kind }) {
  const content = (
    <>
      <span className="emoji" aria-hidden="true">
        {KIND_EMOJI[kind]}
      </span>
      {KIND_LABEL[kind]}
    </>
  );
  return link ? (
    <Link className={`tag tag-kind ${className}`.trim()} to={browseHref({ kind })}>
      {content}
    </Link>
  ) : (
    <span className={`tag tag-kind ${className}`.trim()}>{content}</span>
  );
}
