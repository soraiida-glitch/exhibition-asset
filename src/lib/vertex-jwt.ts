/**
 * RELVA_BI_開発方針報告書_v2.docx §3.5 — Vertex AI(サービスアカウント経由でのClaude呼び出し)
 * 用の、自己署名JWT(Google OAuth2 JWTベアラーグラント、RFC 7523)組み立て。
 *
 * 実機のn8nで、n8nのCode node(task runner)は require("crypto") を
 * "Module 'crypto' is disallowed" として拒否し、グローバルの crypto(Web Crypto API)も
 * 存在しない(実際にライブでどちらも確認済み)。そのため、SHA-256・RSA署名(PKCS#1 v1.5)・
 * PKCS8鍵のDERパースを、Buffer/BigInt(素のJS言語機能であり、requireもcrypto拡張も不要)
 * だけで自前実装する——自己完結ファイル(record-to-text.ts/semantic/aggregate.tsと同じ
 * `.toString()`連結による埋め込みパターン)。
 */

// ---- base64url ----------------------------------------------------------------------------

export function base64url(input: string | Uint8Array): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---- 純JS SHA-256(FIPS 180-4) -------------------------------------------------------------

export function sha256(bytes: Uint8Array): Uint8Array {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const msgLen = bytes.length;
  const bitLen = msgLen * 8;
  let totalLen = msgLen + 1;
  while (totalLen % 64 !== 56) totalLen++;
  totalLen += 8;
  const padded = new Uint8Array(totalLen);
  padded.set(bytes);
  padded[msgLen] = 0x80;
  // 64bit big-endianのビット長(JWT程度の入力長ならhi=0で十分だが、念のため正しく計算する)。
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  padded[totalLen - 8] = (hi >>> 24) & 0xff;
  padded[totalLen - 7] = (hi >>> 16) & 0xff;
  padded[totalLen - 6] = (hi >>> 8) & 0xff;
  padded[totalLen - 5] = hi & 0xff;
  padded[totalLen - 4] = (lo >>> 24) & 0xff;
  padded[totalLen - 3] = (lo >>> 16) & 0xff;
  padded[totalLen - 2] = (lo >>> 8) & 0xff;
  padded[totalLen - 1] = lo & 0xff;

  function rotr(x: number, n: number): number {
    return ((x >>> n) | (x << (32 - n))) >>> 0;
  }

  const w = new Uint32Array(64);
  for (let chunk = 0; chunk < totalLen; chunk += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] =
        ((padded[chunk + i * 4] << 24) |
          (padded[chunk + i * 4 + 1] << 16) |
          (padded[chunk + i * 4 + 2] << 8) |
          padded[chunk + i * 4 + 3]) >>>
        0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((h, i) => {
    out[i * 4] = (h >>> 24) & 0xff;
    out[i * 4 + 1] = (h >>> 16) & 0xff;
    out[i * 4 + 2] = (h >>> 8) & 0xff;
    out[i * 4 + 3] = h & 0xff;
  });
  return out;
}

// ---- BigInt法によるモジュラー冪乗(RSA署名の核) -------------------------------------------

export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return result;
}

// ---- PKCS8(PEM)からRSA秘密鍵のn(modulus)・d(privateExponent)を取り出す最小限のDERパーサ ----

interface DerTlv {
  tag: number;
  valueOffset: number;
  nextOffset: number;
}

function derReadTlv(buf: Uint8Array, offset: number): DerTlv {
  const tag = buf[offset];
  const lenByte = buf[offset + 1];
  let length: number;
  let valueOffset: number;
  if (lenByte & 0x80) {
    const numBytes = lenByte & 0x7f;
    length = 0;
    for (let i = 0; i < numBytes; i++) length = (length << 8) | buf[offset + 2 + i];
    valueOffset = offset + 2 + numBytes;
  } else {
    length = lenByte;
    valueOffset = offset + 2;
  }
  return { tag, valueOffset, nextOffset: valueOffset + length };
}

function derReadInteger(buf: Uint8Array, offset: number): { value: bigint; nextOffset: number } {
  const tlv = derReadTlv(buf, offset);
  if (tlv.tag !== 0x02) throw new Error(`expected DER INTEGER (0x02), got 0x${tlv.tag.toString(16)}`);
  let value = 0n;
  for (let i = tlv.valueOffset; i < tlv.nextOffset; i++) value = (value << 8n) | BigInt(buf[i]);
  return { value, nextOffset: tlv.nextOffset };
}

function pemToDer(pem: string): Uint8Array {
  const b64 = pem.replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s+/g, '');
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/** PKCS8(-----BEGIN PRIVATE KEY-----)形式のRSA秘密鍵から、署名に必要なn/dだけを取り出す。
 * GCPサービスアカウントのJSON鍵のprivate_keyフィールドはこの形式。 */
export function parsePkcs8RsaPrivateKey(pem: string): { n: bigint; d: bigint } {
  const der = pemToDer(pem);
  const outer = derReadTlv(der, 0); // PrivateKeyInfo SEQUENCE
  const version = derReadTlv(der, outer.valueOffset); // version INTEGER
  const alg = derReadTlv(der, version.nextOffset); // AlgorithmIdentifier SEQUENCE
  const octetString = derReadTlv(der, alg.nextOffset); // privateKey OCTET STRING
  if (octetString.tag !== 0x04) throw new Error('expected OCTET STRING for PKCS8 privateKey field');

  // OCTET STRINGの中身が、もう1段DER-encodedなPKCS1 RSAPrivateKey SEQUENCE。
  const rsaSeq = derReadTlv(der, octetString.valueOffset);
  let pos = rsaSeq.valueOffset;
  const rsaVersion = derReadInteger(der, pos); pos = rsaVersion.nextOffset;
  const modulus = derReadInteger(der, pos); pos = modulus.nextOffset;
  const publicExponent = derReadInteger(der, pos); pos = publicExponent.nextOffset;
  const privateExponent = derReadInteger(der, pos);

  return { n: modulus.value, d: privateExponent.value };
}

// ---- RSASSA-PKCS1-v1_5 with SHA-256 署名 ----------------------------------------------------

// SHA-256のDigestInfo接頭辞(PKCS#1 v1.5の標準定数、あらゆる実装で共通)。
const SHA256_DIGEST_INFO_PREFIX = new Uint8Array([
  0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20,
]);

function bigintToBytes(value: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (let i = 0; i < bytes.length; i++) value = (value << 8n) | BigInt(bytes[i]);
  return value;
}

/** message(UTF-8文字列)を、privateKeyPem(PKCS8のRSA秘密鍵)でRSASSA-PKCS1-v1_5 + SHA-256
 * 署名し、base64url文字列で返す(JWTの3番目のセグメント)。 */
export function signRs256(message: string, privateKeyPem: string): string {
  const { n, d } = parsePkcs8RsaPrivateKey(privateKeyPem);
  const keyByteLength = Math.ceil(n.toString(2).length / 8);
  const hash = sha256(new Uint8Array(Buffer.from(message, 'utf8')));

  const digestInfo = new Uint8Array(SHA256_DIGEST_INFO_PREFIX.length + hash.length);
  digestInfo.set(SHA256_DIGEST_INFO_PREFIX, 0);
  digestInfo.set(hash, SHA256_DIGEST_INFO_PREFIX.length);

  const padLength = keyByteLength - digestInfo.length - 3;
  if (padLength < 8) throw new Error('RSA key too small for SHA-256 PKCS#1 v1.5 padding');
  const padded = new Uint8Array(keyByteLength);
  padded[0] = 0x00;
  padded[1] = 0x01;
  for (let i = 0; i < padLength; i++) padded[2 + i] = 0xff;
  padded[2 + padLength] = 0x00;
  padded.set(digestInfo, 3 + padLength);

  const signatureInt = modPow(bytesToBigInt(padded), d, n);
  const signatureBytes = bigintToBytes(signatureInt, keyByteLength);
  return base64url(signatureBytes);
}

// ---- Google OAuth2 JWTベアラーグラント用の自己署名JWT組み立て -----------------------------

/** サービスアカウントのclient_email/private_keyから、Google OAuth2のJWTベアラーグラント
 * (RFC 7523)用の自己署名JWTを組み立てる。nowSecondsは呼び出し側が渡す(Date.now()を
 * この関数自身が呼ばない自己完結パターン——record-to-text.ts/semantic/*.tsと同じ)。 */
export function buildGoogleServiceAccountJwt(serviceAccountEmail: string, privateKeyPem: string, nowSeconds: number): string {
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: serviceAccountEmail,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = signRs256(signingInput, privateKeyPem);
  return `${signingInput}.${signature}`;
}

/**
 * `recordToTextEmbeddable()`(src/lib/record-to-text.ts)と同じ手法: 各関数を`.toString()`
 * して連結し、n8nのCode nodeにそのまま貼り付けて実行できる文字列を返す。SHA256_DIGEST_
 * INFO_PREFIXはUint8Arrayの定数なので、配列データをJSON化して再構築するコードを先頭に足す。
 */
export function vertexJwtEmbeddable(): string {
  // esbuild(tsx経由でのdeployスクリプト実行時)が名前保持のため関数宣言に__name(fn, "name")
  // 呼び出しを注入することがある——他のxxxEmbeddable()(aggregate.ts/fiscal.ts/cards.ts)と
  // 同じダミーshimで無害化する。
  const shim = 'function __name(fn) { return fn; }';
  const consts = [`const SHA256_DIGEST_INFO_PREFIX = new Uint8Array(${JSON.stringify(Array.from(SHA256_DIGEST_INFO_PREFIX))});`];
  const fns = [
    base64url,
    sha256,
    modPow,
    derReadTlv,
    derReadInteger,
    pemToDer,
    parsePkcs8RsaPrivateKey,
    bigintToBytes,
    bytesToBigInt,
    signRs256,
    buildGoogleServiceAccountJwt,
  ].map((fn) => fn.toString());
  return [shim, ...consts, ...fns].join('\n');
}
