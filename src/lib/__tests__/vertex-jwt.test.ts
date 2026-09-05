import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { base64url, buildGoogleServiceAccountJwt, modPow, parsePkcs8RsaPrivateKey, sha256, signRs256, vertexJwtEmbeddable } from '../vertex-jwt';

// テスト専用の使い捨てRSA鍵ペア(実在のGCPサービスアカウントとは無関係)。
const TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDARW3bqYb0BFUF
QtbFNFYM3AeSLMeC5UzJU9NHrVEGDW7Ctdb47tChIG/JUX+zqp3o/FnIiKL+J3P/
/aWC+cV1Sb688LeMxj7s+avRGJqMrffwiYdVAHgLcJUCmO74ggWSHD3rqpXxJrl7
U/Xp19E+H+7KXEwyK/EkhdUTVj97BbHePWOs5DY4DtZNH6gz8B2iwTW8TMKbJLe4
R9gyYzwq+VHHO78VgTVtq2UP9lTfu4r+oXqZJR9p6ZRjdJKBs6bZ1MLhj41eGA7s
cN3ld5EmiUCCwu3Gs/rgY2cFco+UpUXzu+Wf2R6k+4RzLBMTID8ofz3u0/hWltev
LG631DORAgMBAAECggEABjGmZJttPsqt732z/AXf2Mm0z7t0EO4wn1K9PXOiptKD
dS/U9U+CNpKcL0zaE5BlRmZswQZP0+ay+LXz4UiJGSpvQ9hwXU9coxc29wU3I12O
XXgcvTsG4v11O3BwUF6l7ctNnlwwOOTRuFyf0TDz62+tamT3Sm16dv39u4H9iQm7
X6FZx4asuE0OSsD1P1Hl7g0rQWxv9IbsQ9EhnnO+7IOBaLTMbYgFdfyqup5ql9Rp
o79sqSk/gN1yuGviGjV0r8GKCaj2fSmDEtA8J02lep9KZTmx/r8XV1RRi63SgQb3
2ifeW8w1SuCEvKKhlRi/3y6YhCf0nvjXWpa7hKmmrQKBgQDmDJQ6BRC86eGbnxPv
I3WMPUpySjTYY50BS4EfSyD+FgvmwcEghArgp/3RXBrwvVDjMpNZgPqCeyOv+a0X
3Ubqa0YYYYmIfAPZg/hVrQzX80YseAJxsaG2kLRK+CI9k+DJNp9Z5wtntkY4X14L
CzQKGek6UJCGMlMxTCEkizO/HQKBgQDV9eOO26NOQ0K13i8hGRH8QjJt45Cb3C3b
f/o7sn+0H10qAMFTQlGuxdgsBmoFrVgTqhiRfNG+S2M14dbvrDVVy0KDMHMhdDD6
aIY86pCkX1X98PljJCB5MCsrNY5hezVUb8jZAHzTkZOqVamRWulz2FvJoLEl8Qnc
1sWOFwXYBQKBgBP2bXpnbB9okDpH4Jv00MN9ohMu200Xv80X9zl29IL3+Mpqb87Z
hnQeP8lGG9ReKUG95slyhsqB0wP3P4z9l6TJ8Eg3Vo7wbAkZCZitrpqisqkzNMsW
5fiIsAx9YcNELNJpGgTcJsI2L/u+UtPUggyKWRHFYfUzMsLpX0rjhXcFAoGAJ/aq
j1dk9ExJ3JBoeyUkn9p5ct8LdqE0i4gm5BmeErW9AAhuE7ASc7OOggKcsPzEs7+U
oTAQORv5punM7K1ctO6nOLvG9VuvfkYhtKUXaSxJcooc+rCXxCsEFSkGtByARIow
mJ+nsRjC3RDtADJb4oBp/IogLHcOIYqYEccpF0UCgYBpDvqCAaUTPweFHaYsHa8x
sX1ET4wCmzlY4IWPBh+IvmxBWrKmvF8S4qI1c0SjzVDeNvf5OX+uUzPDLYSdAsVb
y8liwnEZn23ufOOEbvi8dKTIDUzCjzIU38+p0KNC2PX+V0ccrx/w7lXFynbYsdfZ
Zu/bK/JXhR9qEpxiswvG7A==
-----END PRIVATE KEY-----
`;

describe('sha256 (純JS実装, requireやNode cryptoに依存しない)', () => {
  it('matches Node crypto for the empty string (well-known test vector)', () => {
    const out = Buffer.from(sha256(new Uint8Array(0))).toString('hex');
    expect(out).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('matches Node crypto for "abc" (FIPS 180-4 test vector)', () => {
    const out = Buffer.from(sha256(new Uint8Array(Buffer.from('abc', 'utf8')))).toString('hex');
    expect(out).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('matches Node crypto for a long, multi-block input (>64 bytes, exercises the chunk loop)', () => {
    const input = 'a'.repeat(200) + 'JWT signing test payload with punctuation!? 日本語も含む。';
    const expected = crypto.createHash('sha256').update(input, 'utf8').digest('hex');
    const out = Buffer.from(sha256(new Uint8Array(Buffer.from(input, 'utf8')))).toString('hex');
    expect(out).toBe(expected);
  });

  it('matches Node crypto for an input that lands exactly on a 64-byte block boundary (padding edge case)', () => {
    const input = 'x'.repeat(55); // 55 bytes + 0x80 = 56, exactly the padding boundary
    const expected = crypto.createHash('sha256').update(input, 'utf8').digest('hex');
    const out = Buffer.from(sha256(new Uint8Array(Buffer.from(input, 'utf8')))).toString('hex');
    expect(out).toBe(expected);
  });
});

describe('modPow', () => {
  it('computes modular exponentiation correctly against known small values', () => {
    expect(modPow(4n, 13n, 497n)).toBe(445n); // textbook RSA example
    expect(modPow(2n, 10n, 1000n)).toBe(24n); // 1024 mod 1000
  });
});

describe('parsePkcs8RsaPrivateKey', () => {
  it('extracts n/d matching Node crypto\'s own view of the same key', () => {
    const { n, d } = parsePkcs8RsaPrivateKey(TEST_PRIVATE_KEY);
    const keyObject = crypto.createPrivateKey(TEST_PRIVATE_KEY);
    const jwk = keyObject.export({ format: 'jwk' }) as { n: string; d: string };
    const b64urlToBigInt = (b64url: string) => BigInt(`0x${Buffer.from(b64url.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('hex')}`);
    expect(n).toBe(b64urlToBigInt(jwk.n));
    expect(d).toBe(b64urlToBigInt(jwk.d));
  });
});

describe('signRs256 (RSASSA-PKCS1-v1_5 + SHA-256, requireやNode cryptoモジュールに依存しない)', () => {
  it('produces a signature that Node crypto.verify accepts as valid for the message', () => {
    const message = 'header.claims-fragment-for-testing';
    const sigB64url = signRs256(message, TEST_PRIVATE_KEY);
    const signature = Buffer.from(sigB64url.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const publicKey = crypto.createPublicKey(TEST_PRIVATE_KEY);
    const ok = crypto.verify('RSA-SHA256', Buffer.from(message, 'utf8'), publicKey, signature);
    expect(ok).toBe(true);
  });

  it('produces a signature Node rejects for a tampered message (not a rubber-stamp always-true check)', () => {
    const sigB64url = signRs256('original message', TEST_PRIVATE_KEY);
    const signature = Buffer.from(sigB64url.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const publicKey = crypto.createPublicKey(TEST_PRIVATE_KEY);
    const ok = crypto.verify('RSA-SHA256', Buffer.from('a different message', 'utf8'), publicKey, signature);
    expect(ok).toBe(false);
  });
});

describe('buildGoogleServiceAccountJwt', () => {
  it('produces a 3-part JWT whose header/claims are correct and whose signature Node crypto.verify accepts', () => {
    const jwt = buildGoogleServiceAccountJwt('sa@example.iam.gserviceaccount.com', TEST_PRIVATE_KEY, 1_700_000_000);
    const [headerB64, claimsB64, sigB64url] = jwt.split('.');
    expect(jwt.split('.')).toHaveLength(3);

    const decode = (b64url: string) => JSON.parse(Buffer.from(b64url.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    expect(decode(headerB64)).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claims = decode(claimsB64);
    expect(claims).toEqual({
      iss: 'sa@example.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });

    const signature = Buffer.from(sigB64url.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const publicKey = crypto.createPublicKey(TEST_PRIVATE_KEY);
    const ok = crypto.verify('RSA-SHA256', Buffer.from(`${headerB64}.${claimsB64}`, 'utf8'), publicKey, signature);
    expect(ok).toBe(true);
  });
});

describe('base64url', () => {
  it('strips padding and uses URL-safe characters', () => {
    expect(base64url('sub')).toBe(Buffer.from('sub').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
    expect(base64url('sub')).not.toContain('=');
  });
});

describe('vertexJwtEmbeddable', () => {
  it('executes standalone and produces the same result as the imported implementation (n8n Code node embedding)', () => {
    const embeddable = vertexJwtEmbeddable();
    const isolatedFn = new Function(
      `${embeddable}\nreturn buildGoogleServiceAccountJwt(arguments[0], arguments[1], arguments[2]);`,
    ) as (email: string, key: string, now: number) => string;

    const jwt = isolatedFn('sa@example.iam.gserviceaccount.com', TEST_PRIVATE_KEY, 1_700_000_000);
    expect(jwt).toBe(buildGoogleServiceAccountJwt('sa@example.iam.gserviceaccount.com', TEST_PRIVATE_KEY, 1_700_000_000));
  });
});
