/**
 * HTTP client for communicating with the relay server.
 * All mobile-to-desktop communication goes through HTTP requests
 * that the relay bridges to the desktop via WebSocket.
 *
 * No WebSocket connection is maintained on the mobile side.
 */

import {
  generateKeyPair,
  deriveSharedKey,
  encrypt,
  decrypt,
  toB64,
  fromB64,
  type MobileKeyPair,
} from './E2EEncryption';

export class RelayHttpClient {
  private relayUrl: string;
  private roomId: string;
  private sharedKey: Uint8Array | null = null;
  private keyPair: MobileKeyPair | null = null;

  constructor(relayUrl: string, roomId: string) {
    this.relayUrl = relayUrl.replace(/\/$/, '');
    this.roomId = roomId;
  }

  /**
   * Pair with the desktop via two HTTP round-trips:
   * 1. POST /pair with our public key → receive encrypted challenge
   * 2. POST /command with encrypted challenge_echo → receive initial_sync
   */
  async pair(
    desktopPubKeyB64: string,
    identity: {
      userId: string;
      mobileInstallId: string;
    },
  ): Promise<any> {
    this.keyPair = await generateKeyPair();
    const desktopPub = fromB64(desktopPubKeyB64);
    this.sharedKey = await deriveSharedKey(this.keyPair, desktopPub);

    const deviceId = identity.mobileInstallId;
    const deviceName = this.getMobileDeviceName();
    const userId = identity.userId.trim();
    const mobileInstallId = identity.mobileInstallId.trim();

    // Step 1: POST /pair → encrypted challenge
    const pairData = await this.postRoomJson('pair', {
      public_key: toB64(this.keyPair.publicKey),
      device_id: deviceId,
      device_name: deviceName,
    }, 'Pairing failed');
    const challengeJson = await decrypt(
      this.sharedKey,
      pairData.encrypted_data,
      pairData.nonce,
    );
    const challenge = JSON.parse(challengeJson);

    // Step 2: POST /command with challenge_echo → initial_sync
    const challengeResponse = JSON.stringify({
      challenge_echo: challenge.challenge,
      device_id: deviceId,
      device_name: deviceName,
      mobile_install_id: mobileInstallId,
      user_id: userId,
    });
    const cmdData = await this.postRoomJson(
      'command',
      await this.encryptPayload(challengeResponse),
      'Pairing verification failed',
    );
    const initialSyncJson = await decrypt(
      this.sharedKey,
      cmdData.encrypted_data,
      cmdData.nonce,
    );
    const parsed = JSON.parse(initialSyncJson);
    if (parsed?.resp === 'error') {
      throw new Error(parsed?.message || 'Pairing rejected');
    }
    return parsed;
  }

  /**
   * Send an encrypted command to the desktop and return the decrypted response.
   */
  async sendCommand<T = any>(cmd: object): Promise<T> {
    if (!this.sharedKey) throw new Error('Not paired');

    const data = await this.postRoomJson(
      'command',
      await this.encryptPayload(JSON.stringify(cmd)),
      'Command failed',
    );
    const decrypted = await decrypt(
      this.sharedKey,
      data.encrypted_data,
      data.nonce,
    );
    return JSON.parse(decrypted) as T;
  }

  get isPaired(): boolean {
    return this.sharedKey !== null;
  }

  private getMobileDeviceName(): string {
    const ua = navigator.userAgent;
    if (/iPhone/i.test(ua)) return 'iPhone';
    if (/iPad/i.test(ua)) return 'iPad';
    if (/Android/i.test(ua)) return 'Android';
    return 'Mobile Browser';
  }

  private roomEndpoint(action: 'pair' | 'command'): string {
    return `${this.relayUrl}/api/rooms/${this.roomId}/${action}`;
  }

  private async postRoomJson(action: 'pair' | 'command', payload: object, errorPrefix: string): Promise<any> {
    const response = await fetch(this.roomEndpoint(action), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`${errorPrefix}: HTTP ${response.status}`);
    }

    return response.json();
  }

  private async encryptPayload(plaintext: string): Promise<{ encrypted_data: string; nonce: string }> {
    if (!this.sharedKey) {
      throw new Error('Not paired');
    }

    const { data, nonce } = await encrypt(this.sharedKey, plaintext);
    return { encrypted_data: data, nonce };
  }
}
