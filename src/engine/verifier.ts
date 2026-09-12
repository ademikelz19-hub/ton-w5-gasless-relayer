import { Address, beginCell } from '@ton/core';
import { signVerify } from '@ton/crypto';
import { WalletContractV5R1, TonClient } from '@ton/ton';
import { W5ParsedPayload, RelayErrorCode } from './types.js';

export interface VerificationResult {
  isValid: boolean;
  errorCode?: RelayErrorCode;
  errorMessage?: string;
  onChainSeqno?: number;
}

export class SignatureVerifier {
  /**
   * Normalize a public key string (hex or base64) to a 32-byte Buffer.
   */
  public static normalizePublicKey(publicKey: string | Buffer): Buffer {
    if (Buffer.isBuffer(publicKey)) {
      if (publicKey.length !== 32) {
        throw new Error(`Invalid public key length: expected 32 bytes, got ${publicKey.length}`);
      }
      return publicKey;
    }

    const trimmed = publicKey.trim();
    if (trimmed.length === 64 && /^[0-9a-fA-F]+$/.test(trimmed)) {
      return Buffer.from(trimmed, 'hex');
    }

    // Attempt base64 decode
    const buf = Buffer.from(trimmed, 'base64');
    if (buf.length === 32) {
      return buf;
    }

    throw new Error('Public key must be a 64-character hex string or 32-byte base64 string');
  }

  /**
   * Verify that the provided userWalletAddress matches the WalletContractV5R1 derived from the public key.
   */
  public static verifyAddressOwnership(publicKey: Buffer, userWalletAddress: string): boolean {
    try {
      const targetAddress = Address.parse(userWalletAddress);
      
      // Test both mainnet context and testnet context if needed
      const expectedWalletTestnet = WalletContractV5R1.create({
        publicKey,
        walletId: {
          networkGlobalId: -3,
          context: {
            workChain: targetAddress.workChain,
            walletVersion: 'v5r1',
            subwalletNumber: 0,
          },
        },
      });

      const expectedWalletDefault = WalletContractV5R1.create({
        publicKey,
        workChain: targetAddress.workChain,
      });

      return (
        expectedWalletTestnet.address.equals(targetAddress) ||
        expectedWalletDefault.address.equals(targetAddress)
      );
    } catch {
      return false;
    }
  }

  /**
   * Perform comprehensive cryptographic and timing verification of a parsed W5 payload off-chain.
   */
  public static verifyCryptographicIntegrity(
    parsedPayload: W5ParsedPayload,
    publicKey: Buffer,
    clockDriftBufferSec: number = 5
  ): { isValid: boolean; errorCode?: RelayErrorCode; errorMessage?: string } {
    // 1. Expiration check
    const nowSec = Math.floor(Date.now() / 1000);
    if (parsedPayload.validUntil <= nowSec + clockDriftBufferSec) {
      return {
        isValid: false,
        errorCode: 'TRANSACTION_EXPIRED',
        errorMessage: `Payload expired at timestamp ${parsedPayload.validUntil} (current time: ${nowSec})`,
      };
    }

    // 2. Cryptographic Ed25519 signature verification
    const isSigValid = signVerify(
      parsedPayload.signingHash,
      parsedPayload.signature,
      publicKey
    );

    if (!isSigValid) {
      return {
        isValid: false,
        errorCode: 'SIGNATURE_VERIFICATION_FAILED',
        errorMessage: 'Ed25519 signature verification failed for signing root hash',
      };
    }

    return { isValid: true };
  }

  /**
   * Query the on-chain seqno of the user's W5 wallet and verify that the payload seqno matches.
   */
  public static async verifyOnChainSeqno(
    client: TonClient,
    userAddress: Address,
    payloadSeqno: number
  ): Promise<{ isValid: boolean; onChainSeqno: number; errorMessage?: string }> {
    try {
      const state = await client.getContractState(userAddress);

      if (state.state !== 'active') {
        // Uninitialized wallet: seqno must be 0
        if (payloadSeqno !== 0) {
          return {
            isValid: false,
            onChainSeqno: 0,
            errorMessage: `Wallet contract is uninitialized. Expected seqno 0, got ${payloadSeqno}`,
          };
        }
        return { isValid: true, onChainSeqno: 0 };
      }

      // Query get_seqno run method
      const res = await client.runMethod(userAddress, 'seqno');
      const onChainSeqno = res.stack.readNumber();

      if (payloadSeqno !== onChainSeqno) {
        return {
          isValid: false,
          onChainSeqno,
          errorMessage: `Seqno mismatch. Contract seqno is ${onChainSeqno}, but payload specifies ${payloadSeqno}`,
        };
      }

      return { isValid: true, onChainSeqno };
    } catch (err: any) {
      // If contract has not been deployed yet or runMethod fails due to uninit state
      if (err.message && err.message.includes('exit_code: -13')) {
        return { isValid: payloadSeqno === 0, onChainSeqno: 0 };
      }
      throw err;
    }
  }
}
