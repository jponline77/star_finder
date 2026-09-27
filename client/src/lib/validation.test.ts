import { describe, expect, it } from 'vitest';
import { charCount, passwordStrength, validateDisplayName, validateEmail, validatePassword } from './validation';

describe('validateEmail', () => {
  it.each(['a@b.co', '  kid@school.ca ', 'first.last+tag@example.org'])('accepts %j', (v) => {
    expect(validateEmail(v)).toBeNull();
  });
  it.each(['', '   ', 'nope', 'a@b', '@b.co', 'a b@c.co', `${'a'.repeat(250)}@b.co`])('rejects %j', (v) => {
    expect(validateEmail(v)).toBeTypeOf('string');
  });
});

describe('validatePassword', () => {
  it('enforces 8–200 chars', () => {
    expect(validatePassword('')).toMatch(/Enter/);
    expect(validatePassword('1234567')).toMatch(/at least 8/);
    expect(validatePassword('12345678')).toBeNull();
    expect(validatePassword('x'.repeat(201))).toMatch(/under 200/);
  });
});

describe('validateDisplayName', () => {
  it('enforces 2–40 chars, no emails or urls', () => {
    expect(validateDisplayName('')).toMatch(/Pick/);
    expect(validateDisplayName(' a ')).toMatch(/at least 2/);
    expect(validateDisplayName('Jo')).toBeNull();
    expect(validateDisplayName('Broadway Baby 07')).toBeNull();
    expect(validateDisplayName('x'.repeat(41))).toMatch(/40/);
    expect(validateDisplayName('me@x.com')).toMatch(/email/);
    expect(validateDisplayName('see mysite.com')).toMatch(/link/);
    expect(validateDisplayName('https://x')).toMatch(/link/);
  });
});

describe('passwordStrength', () => {
  it('scores from too short to showstopper', () => {
    expect(passwordStrength('').score).toBe(0);
    expect(passwordStrength('abc').label).toBe('Too short');
    expect(passwordStrength('abcdefgh').score).toBe(1);
    expect(passwordStrength('abcdefg1').score).toBe(2);
    expect(passwordStrength('abcdefghijk1').score).toBe(3);
    expect(passwordStrength('Tr0mbone-Solo!').label).toBe('Showstopper!');
    expect(passwordStrength('aaaaaaaaaaaaaa').score).toBe(1);
    expect(passwordStrength('password123').score).toBe(1);
  });
});

describe('charCount', () => {
  it('counts code points like the server, not UTF-16 units', () => {
    expect(charCount('abc')).toBe(3);
    expect(charCount('🎤'.repeat(600))).toBe(600);
    expect('🎤'.repeat(600).length).toBe(1200);
    expect(charCount('e\u0301')).toBe(1); // NFC: e + combining acute → é
  });
});
