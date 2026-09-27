/** Tiny in-memory TTL cache with a size cap (oldest entries evicted first). */
export class TtlCache {
  constructor({ ttlMs = 60 * 60 * 1000, max = 500 } = {}) {
    this.ttlMs = ttlMs;
    this.max = max;
    /** @type {Map<string, { value: unknown, expires: number }>} */
    this.map = new Map();
  }

  get(key) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key, value) {
    this.map.delete(key);
    this.map.set(key, { value, expires: Date.now() + this.ttlMs });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
    return value;
  }
}

/**
 * Keeps one computed value per key until `version()` changes (e.g. the catalogue's catalogVersion).
 * Values may be promises (async work shares one computation; a rejected one is dropped).
 */
export class VersionedCache {
  /** @param {() => string} version */
  constructor(version) {
    this.version = version;
    /** @type {Map<string, { version: string, value: unknown }>} */
    this.map = new Map();
  }

  /**
   * @template T
   * @param {string} key
   * @param {() => T} compute
   * @returns {T}
   */
  get(key, compute) {
    const version = this.version();
    const hit = this.map.get(key);
    if (hit && hit.version === version) return /** @type {T} */ (hit.value);
    const value = compute();
    this.map.set(key, { version, value });
    if (value && typeof value.then === 'function') {
      value.then(undefined, () => {
        if (this.map.get(key)?.value === value) this.map.delete(key);
      });
    }
    return value;
  }
}
