import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { ArtworkTile, ShowPoster } from '../ArtworkTile';

describe('ArtworkTile', () => {
  it('tries the new image after the previous src failed to load', () => {
    const { container, rerender } = render(<ArtworkTile src="/media/art/missing.jpg" seed="Hadestown" />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull(); // fallback initials
    rerender(<ArtworkTile src="/media/art/shrek.jpg" seed="Shrek The Musical" />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', '/media/art/shrek.jpg');
    // …and going straight back to the one that just failed keeps the fallback
    rerender(<ArtworkTile src="/media/art/missing.jpg" seed="Hadestown" />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('does not show a new image as loaded before it has loaded', () => {
    const { container, rerender } = render(<ArtworkTile src="/a.jpg" seed="A" />);
    fireEvent.load(container.querySelector('img')!);
    expect(container.querySelector('img')).toHaveClass('is-loaded');
    rerender(<ArtworkTile src="/b.jpg" seed="B" />);
    expect(container.querySelector('img')).not.toHaveClass('is-loaded');
  });

  it('ShowPoster also recovers when the poster changes', () => {
    const { container, rerender } = render(<ShowPoster show={{ name: 'Wicked', imageUrl: '/broken.jpg' }} />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    rerender(<ShowPoster show={{ name: 'Wicked', imageUrl: '/media/shows/wicked.jpg' }} />);
    expect(container.querySelector('img')).toHaveAttribute('src', '/media/shows/wicked.jpg');
  });
});
