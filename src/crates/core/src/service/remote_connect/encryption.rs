//! End-to-end encryption for Remote Connect.
//!
//! Uses X25519 ECDH for key exchange and AES-256-GCM for authenticated
//! encryption. Both sides generate ephemeral keypairs. The shared secret is
//! derived through ECDH and used as the AES-256-GCM key.

use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Nonce};
use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rand::RngCore;
use x25519_dalek::{PublicKey, StaticSecret};

const NONCE_SIZE: usize = 12;
const X25519_KEY_SIZE: usize = 32;

/// Holds a keypair for X25519 ECDH key exchange.
pub struct KeyPair {
    secret: StaticSecret,
    public: PublicKey,
}

impl KeyPair {
    pub fn generate() -> Self {
        let secret = StaticSecret::random_from_rng(OsRng);
        let public = PublicKey::from(&secret);
        Self { secret, public }
    }

    pub fn public_key_bytes(&self) -> [u8; X25519_KEY_SIZE] {
        self.public.to_bytes()
    }

    pub fn public_key_base64(&self) -> String {
        BASE64.encode(self.public.to_bytes())
    }

    /// Derive a shared secret from our secret key and the peer's public key.
    pub fn derive_shared_secret(
        &self,
        peer_public_bytes: &[u8; X25519_KEY_SIZE],
    ) -> [u8; X25519_KEY_SIZE] {
        let peer_public = PublicKey::from(*peer_public_bytes);
        let shared = self.secret.diffie_hellman(&peer_public);
        *shared.as_bytes()
    }
}

/// Encrypts plaintext using AES-256-GCM with a random nonce.
/// Returns `(ciphertext, nonce)` both as raw bytes.
pub fn encrypt(
    shared_secret: &[u8; X25519_KEY_SIZE],
    plaintext: &[u8],
) -> Result<(Vec<u8>, [u8; NONCE_SIZE])> {
    let cipher = cipher_from_secret(shared_secret)?;
    let nonce_bytes = random_nonce();
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plaintext)
        .map_err(|e| anyhow!("encrypt: {e}"))?;

    Ok((ciphertext, nonce_bytes))
}

/// Decrypts ciphertext using AES-256-GCM.
pub fn decrypt(
    shared_secret: &[u8; X25519_KEY_SIZE],
    ciphertext: &[u8],
    nonce_bytes: &[u8; NONCE_SIZE],
) -> Result<Vec<u8>> {
    cipher_from_secret(shared_secret)?
        .decrypt(Nonce::from_slice(nonce_bytes), ciphertext)
        .map_err(|e| anyhow!("decrypt: {e}"))
}

/// Convenience: encrypt a string and return base64-encoded `(data, nonce)`.
pub fn encrypt_to_base64(
    shared_secret: &[u8; X25519_KEY_SIZE],
    plaintext: &str,
) -> Result<(String, String)> {
    let (ct, nonce) = encrypt(shared_secret, plaintext.as_bytes())?;
    Ok((BASE64.encode(ct), BASE64.encode(nonce)))
}

/// Convenience: decrypt from base64-encoded `(data, nonce)`.
pub fn decrypt_from_base64(
    shared_secret: &[u8; X25519_KEY_SIZE],
    ciphertext_b64: &str,
    nonce_b64: &str,
) -> Result<String> {
    let ct = decode_base64(ciphertext_b64, "ciphertext")?;
    let nonce = decode_fixed_base64::<NONCE_SIZE>(nonce_b64, "nonce")?;
    let plaintext = decrypt(shared_secret, &ct, &nonce)?;

    String::from_utf8(plaintext).map_err(|e| anyhow!("utf8 decode: {e}"))
}

/// Parse a base64-encoded public key into 32-byte array.
pub fn parse_public_key(b64: &str) -> Result<[u8; X25519_KEY_SIZE]> {
    decode_fixed_base64::<X25519_KEY_SIZE>(b64, "public key")
}

fn cipher_from_secret(shared_secret: &[u8; X25519_KEY_SIZE]) -> Result<Aes256Gcm> {
    Aes256Gcm::new_from_slice(shared_secret).map_err(|e| anyhow!("cipher init: {e}"))
}

fn random_nonce() -> [u8; NONCE_SIZE] {
    let mut nonce_bytes = [0u8; NONCE_SIZE];
    OsRng.fill_bytes(&mut nonce_bytes);
    nonce_bytes
}

fn decode_base64(value: &str, label: &str) -> Result<Vec<u8>> {
    BASE64
        .decode(value)
        .map_err(|e| anyhow!("base64 decode {label}: {e}"))
}

fn decode_fixed_base64<const N: usize>(value: &str, label: &str) -> Result<[u8; N]> {
    let bytes = decode_base64(value, label)?;
    if bytes.len() != N {
        return Err(anyhow!(
            "invalid {label} length: expected {N}, got {}",
            bytes.len()
        ));
    }

    let mut output = [0u8; N];
    output.copy_from_slice(&bytes);
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_key_exchange_and_encrypt_decrypt() {
        let alice = KeyPair::generate();
        let bob = KeyPair::generate();

        let alice_shared = alice.derive_shared_secret(&bob.public_key_bytes());
        let bob_shared = bob.derive_shared_secret(&alice.public_key_bytes());
        assert_eq!(alice_shared, bob_shared);

        let message = "Hello, Remote Connect!";
        let (ct, nonce) = encrypt(&alice_shared, message.as_bytes()).unwrap();
        let decrypted = decrypt(&bob_shared, &ct, &nonce).unwrap();
        assert_eq!(decrypted, message.as_bytes());
    }

    #[test]
    fn test_base64_round_trip() {
        let alice = KeyPair::generate();
        let bob = KeyPair::generate();

        let shared = alice.derive_shared_secret(&bob.public_key_bytes());
        let message = "encrypted unicode payload \u{1f512}";
        let (ct_b64, nonce_b64) = encrypt_to_base64(&shared, message).unwrap();
        let decrypted = decrypt_from_base64(&shared, &ct_b64, &nonce_b64).unwrap();
        assert_eq!(decrypted, message);
    }

    #[test]
    fn test_wrong_key_fails() {
        let alice = KeyPair::generate();
        let bob = KeyPair::generate();
        let eve = KeyPair::generate();

        let alice_shared = alice.derive_shared_secret(&bob.public_key_bytes());
        let eve_shared = eve.derive_shared_secret(&bob.public_key_bytes());

        let (ct, nonce) = encrypt(&alice_shared, b"secret").unwrap();
        assert!(decrypt(&eve_shared, &ct, &nonce).is_err());
    }

    #[test]
    fn test_parse_public_key() {
        let kp = KeyPair::generate();
        let b64 = kp.public_key_base64();
        let parsed = parse_public_key(&b64).unwrap();
        assert_eq!(parsed, kp.public_key_bytes());
    }

    #[test]
    fn test_tampered_ciphertext_fails() {
        let alice = KeyPair::generate();
        let bob = KeyPair::generate();
        let shared = alice.derive_shared_secret(&bob.public_key_bytes());

        let (mut ct, nonce) = encrypt(&shared, b"secret data").unwrap();
        if let Some(byte) = ct.last_mut() {
            *byte ^= 0xff;
        }
        assert!(decrypt(&shared, &ct, &nonce).is_err());
    }
}
