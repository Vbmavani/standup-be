import { randomBytes, randomInt, randomUUID } from 'node:crypto';

export const newId = (): string => randomUUID();

/** Session token: 32 random bytes, hex encoded. */
export const newSessionToken = (): string => randomBytes(32).toString('hex');

const INVITE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** Invite code: 8 uppercase alphanumeric characters. */
export function newInviteCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) code += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
  return code;
}
