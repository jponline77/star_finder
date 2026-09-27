import { highlightSegments } from '../lib/filters';

/** Renders `text` with accent-insensitive matches of `query` wrapped in <mark>. */
export function Highlight({ text, query }: { text: string; query?: string | null }) {
  if (!query || !query.trim()) return <>{text}</>;
  const segments = highlightSegments(text, query);
  return (
    <>
      {segments.map((s, i) => (s.match ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>))}
    </>
  );
}
