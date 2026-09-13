import { Request, Response, NextFunction } from 'express';
import { Address } from '@ton/core';
import { config } from '../config.js';
import { RelayResponseError } from '../engine/types.js';

export function preFlightSanitizerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const { userPublicKey, userWalletAddress, payloadBoc, requestedGasTon } = req.body || {};

  // 1. Check required fields
  if (!userPublicKey || typeof userPublicKey !== 'string') {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_REQUEST',
        message: 'Missing or invalid userPublicKey. Must be a hex or base64 string.',
      },
    } satisfies RelayResponseError);
    return;
  }

  if (!userWalletAddress || typeof userWalletAddress !== 'string') {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_REQUEST',
        message: 'Missing or invalid userWalletAddress.',
      },
    } satisfies RelayResponseError);
    return;
  }

  if (!payloadBoc || typeof payloadBoc !== 'string') {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_REQUEST',
        message: 'Missing or invalid payloadBoc.',
      },
    } satisfies RelayResponseError);
    return;
  }

  // 2. Check payload byte size
  const estimatedBytes = Buffer.byteLength(payloadBoc, 'utf8');
  if (estimatedBytes > config.MAX_PAYLOAD_SIZE_BYTES) {
    res.status(413).json({
      success: false,
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: `Payload size (${estimatedBytes} bytes) exceeds maximum allowable limit of ${config.MAX_PAYLOAD_SIZE_BYTES} bytes.`,
      },
    } satisfies RelayResponseError);
    return;
  }

  // 3. Check base64 format
  const base64Regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  if (!base64Regex.test(payloadBoc.trim())) {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_BOC',
        message: 'payloadBoc must be a valid Base64 encoded string.',
      },
    } satisfies RelayResponseError);
    return;
  }

  // 4. Validate TON address format
  try {
    Address.parse(userWalletAddress.trim());
  } catch (err) {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_REQUEST',
        message: `Invalid TON wallet address format: ${userWalletAddress}`,
      },
    } satisfies RelayResponseError);
    return;
  }

  // 5. Validate public key format (64-char hex or 44-char base64)
  const trimmedKey = userPublicKey.trim();
  const isHex = trimmedKey.length === 64 && /^[0-9a-fA-F]+$/.test(trimmedKey);
  const isBase64 = trimmedKey.length === 44 && base64Regex.test(trimmedKey);

  if (!isHex && !isBase64) {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_SIGNATURE',
        message: 'userPublicKey must be a 64-character hex string or 44-character base64 string.',
      },
    } satisfies RelayResponseError);
    return;
  }

  // 6. Validate optional requestedGasTon, if provided — a coarse sanity check here; the
  // real ceiling enforcement happens in GasGuard once we know the operator's configured max.
  if (requestedGasTon !== undefined) {
    if (typeof requestedGasTon !== 'number' || !Number.isFinite(requestedGasTon) || requestedGasTon <= 0) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'requestedGasTon must be a positive number if provided.',
        },
      } satisfies RelayResponseError);
      return;
    }
  }

  next();
}
