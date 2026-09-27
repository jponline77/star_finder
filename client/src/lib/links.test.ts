import { describe, expect, it } from 'vitest';
import { backingTrackUrl, hostOf, isHttpsUrl, isSafeHttpUrl, loginHref, performancesUrl, safeNextPath, sheetMusicUrl } from './links';
import { contrastRatio, hexToRgb, readableTextOn } from './color';

const song = { title: 'Popular', show: { name: 'Wicked' } };

describe('external links', () => {
  it('builds search URLs', () => {
    expect(backingTrackUrl(song)).toBe(
      'https://www.youtube.com/results?search_query=%22Popular%22%20%22Wicked%22%20karaoke%20instrumental',
    );
    expect(performancesUrl(song)).toContain('youtube.com/results');
    expect(sheetMusicUrl(song)).toBe('https://www.musicnotes.com/search/go?w=Popular%20Wicked');
  });
  it('validates URLs', () => {
    expect(isSafeHttpUrl('https://youtube.com')).toBe(true);
    expect(isSafeHttpUrl('http://example.com')).toBe(true);
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('data:text/html,hi')).toBe(false);
    expect(isSafeHttpUrl('/relative')).toBe(false);
    expect(isSafeHttpUrl(null)).toBe(false);
    expect(isHttpsUrl('https://a.b')).toBe(true);
    expect(isHttpsUrl('http://a.b')).toBe(false);
    expect(hostOf('https://www.youtube.com/watch?v=1')).toBe('youtube.com');
    expect(hostOf('nope')).toBe('');
  });
  it('sanitises next paths', () => {
    expect(safeNextPath('/songs?q=x')).toBe('/songs?q=x');
    expect(safeNextPath('//evil.com')).toBe('/');
    expect(safeNextPath('/\\evil.com')).toBe('/');
    expect(safeNextPath('https://evil.com')).toBe('/');
    expect(safeNextPath('/login?next=/x')).toBe('/');
    expect(safeNextPath(null, '/home')).toBe('/home');
    expect(loginHref('/add')).toBe('/login?next=%2Fadd');
    expect(loginHref(null)).toBe('/login');
    expect(loginHref('//evil')).toBe('/login');
  });
  it('rejects next paths the URL parser would turn into another origin', () => {
    // URL parsing strips tab/CR/LF, so "/\t/evil.com" would become protocol-relative "//evil.com".
    expect(safeNextPath('/\t/example.com')).toBe('/');
    expect(safeNextPath('/\n/example.com')).toBe('/');
    expect(safeNextPath('/\r/example.com')).toBe('/');
    expect(safeNextPath('/\u0000/example.com')).toBe('/');
    expect(safeNextPath('/songs\\..\\..\\evil')).toBe('/');
    expect(safeNextPath('/%09/example.com')).toBe('/%09/example.com');
    expect(loginHref('/\t/example.com')).toBe('/login');
  });
  it('returns the normalised same-origin path, query and hash', () => {
    expect(safeNextPath('/songs/5#comments')).toBe('/songs/5#comments');
    expect(safeNextPath('/songs?q=a b')).toBe('/songs?q=a%20b');
    expect(safeNextPath('/shows/../me')).toBe('/me');
    expect(safeNextPath('/LOGIN')).toBe('/');
    expect(safeNextPath('/signup/')).toBe('/');
    expect(safeNextPath('/loginhelp')).toBe('/loginhelp');
  });
});

describe('color', () => {
  it('parses hex', () => {
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('1a1026')).toEqual({ r: 26, g: 16, b: 38 });
    expect(hexToRgb('nope')).toBeNull();
  });
  it('computes contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
    expect(contrastRatio('nope', '#fff')).toBe(1);
    expect(readableTextOn('#ffc94a')).toBe('#1a1026');
    expect(readableTextOn('#20124a')).toBe('#ffffff');
  });
});
