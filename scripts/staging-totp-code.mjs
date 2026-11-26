#!/usr/bin/env node
// Prints the current 6-digit sign-in code for a staging staff account's 2FA setup key (same as an authenticator app).
//   node scripts/staging-totp-code.mjs <SETUP_KEY>
import { createHmac } from 'node:crypto';
const secret = (process.argv[2] ?? '').replace(/\s+/g, '').toUpperCase();
if (!/^[A-Z2-7]{16,}$/.test(secret)) { console.error('Usage: node scripts/staging-totp-code.mjs <SETUP_KEY>'); process.exit(1); }
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
let bits = '';
for (const ch of secret) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
const now = Date.now();
const counter = Buffer.alloc(8);
counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / 30)));
const h = createHmac('sha1', key).update(counter).digest();
const o = h[h.length - 1] & 0xf;
const code = String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
console.log(`Code: ${code}  (valid for ${30 - (Math.floor(now / 1000) % 30)} more seconds)`);
