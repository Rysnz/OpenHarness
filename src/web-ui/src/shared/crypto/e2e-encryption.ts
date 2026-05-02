const ALGO_X25519 = 'X25519';
const ALGO_AES = 'AES-GCM';
const KEY_LENGTH = 256;
const NONCE_LENGTH = 12;
const X25519_KEY_BYTES = 32;

let nobleFallbackRequired: boolean | null = null;

export interface E2EKeyPair {
  publicKey: Uint8Array;
  /** Opaque handle: either a CryptoKeyPair or noble private key bytes. */
  _internal: CryptoKeyPair | Uint8Array;
}

type NobleX25519 = typeof import('@noble/curves/ed25519')['x25519'];

async function supportsWebCryptoX25519(): Promise<boolean> {
  if (nobleFallbackRequired !== null) {
    return !nobleFallbackRequired;
  }

  try {
    await crypto.subtle.generateKey({ name: ALGO_X25519 } as any, true, ['deriveKey']);
    nobleFallbackRequired = false;
    return true;
  } catch {
    nobleFallbackRequired = true;
    return false;
  }
}

async function loadNobleX25519(): Promise<NobleX25519> {
  const { x25519 } = await import('@noble/curves/ed25519');
  return x25519;
}

function randomPrivateKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(X25519_KEY_BYTES));
}

export async function generateKeyPair(): Promise<E2EKeyPair> {
  return (await supportsWebCryptoX25519())
    ? generateKeyPairWebCrypto()
    : generateKeyPairNoble();
}

async function generateKeyPairWebCrypto(): Promise<E2EKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    { name: ALGO_X25519 } as any,
    true,
    ['deriveKey']
  );
  const rawPublicKey = await crypto.subtle.exportKey('raw', (keyPair as CryptoKeyPair).publicKey);

  return {
    publicKey: new Uint8Array(rawPublicKey),
    _internal: keyPair as CryptoKeyPair,
  };
}

async function generateKeyPairNoble(): Promise<E2EKeyPair> {
  const x25519 = await loadNobleX25519();
  const privateKey = randomPrivateKey();

  return {
    publicKey: x25519.getPublicKey(privateKey),
    _internal: privateKey,
  };
}

export async function deriveSharedSecret(
  keyPair: E2EKeyPair,
  peerPublicKey: Uint8Array
): Promise<CryptoKey> {
  return (await supportsWebCryptoX25519())
    ? deriveSharedSecretWebCrypto(keyPair, peerPublicKey)
    : deriveSharedSecretNoble(keyPair, peerPublicKey);
}

async function deriveSharedSecretWebCrypto(
  keyPair: E2EKeyPair,
  peerPublicKey: Uint8Array
): Promise<CryptoKey> {
  const peerKey = await crypto.subtle.importKey(
    'raw',
    peerPublicKey,
    { name: ALGO_X25519 } as any,
    true,
    []
  );

  return crypto.subtle.deriveKey(
    { name: ALGO_X25519, public: peerKey } as any,
    (keyPair._internal as CryptoKeyPair).privateKey,
    { name: ALGO_AES, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

async function deriveSharedSecretNoble(
  keyPair: E2EKeyPair,
  peerPublicKey: Uint8Array
): Promise<CryptoKey> {
  const x25519 = await loadNobleX25519();
  const sharedBytes = x25519.getSharedSecret(keyPair._internal as Uint8Array, peerPublicKey);

  return crypto.subtle.importKey(
    'raw',
    sharedBytes,
    { name: ALGO_AES, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encrypt(
  sharedKey: CryptoKey,
  plaintext: string
): Promise<{ data: string; nonce: string }> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGO_AES, iv: nonce },
    sharedKey,
    new TextEncoder().encode(plaintext)
  );

  return {
    data: uint8ToBase64(new Uint8Array(ciphertext)),
    nonce: uint8ToBase64(nonce),
  };
}

export async function decrypt(
  sharedKey: CryptoKey,
  dataBase64: string,
  nonceBase64: string
): Promise<string> {
  const plainBuffer = await crypto.subtle.decrypt(
    { name: ALGO_AES, iv: base64ToUint8(nonceBase64) },
    sharedKey,
    base64ToUint8(dataBase64)
  );

  return new TextDecoder().decode(plainBuffer);
}

export function publicKeyToBase64(key: Uint8Array): string {
  return uint8ToBase64(key);
}

export function base64ToPublicKey(b64: string): Uint8Array {
  return base64ToUint8(b64);
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
