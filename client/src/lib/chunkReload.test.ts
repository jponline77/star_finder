import { describe, expect, it, vi } from 'vitest';
import { CHUNK_RELOAD_KEY, handleChunkLoadError, installChunkReload } from './chunkReload';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

describe('handleChunkLoadError (stale build after a redeploy)', () => {
  it('reloads once and swallows the error', () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    const event = { preventDefault: vi.fn() };
    expect(handleChunkLoadError(event, { storage, reload, now: () => 50_000 })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(storage.data.get(CHUNK_RELOAD_KEY)).toBe('50000');
  });

  it('does not loop: a second failure right after the reload is let through', () => {
    const storage = memoryStorage({ [CHUNK_RELOAD_KEY]: '50000' });
    const reload = vi.fn();
    const event = { preventDefault: vi.fn() };
    expect(handleChunkLoadError(event, { storage, reload, now: () => 52_000 })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('reloads again for a later deploy', () => {
    const storage = memoryStorage({ [CHUNK_RELOAD_KEY]: '50000' });
    const reload = vi.fn();
    expect(handleChunkLoadError({ preventDefault: vi.fn() }, { storage, reload, now: () => 5_000_000 })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('without storage (blocked) it never reloads, so it can never loop', () => {
    const reload = vi.fn();
    expect(handleChunkLoadError({ preventDefault: vi.fn() }, { storage: null, reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('listens for vite:preloadError on window', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const off = installChunkReload(window);
    expect(add).toHaveBeenCalledWith('vite:preloadError', expect.any(Function));
    off();
    add.mockRestore();
  });
});
