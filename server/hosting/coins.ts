import { DatabaseSchema } from '../db';
import { User } from '../../src/types';
import { newId } from './crypto';

/** Single place that moves coins and writes the ledger (the economy routes use the same rules). */
export function addCoinsTo(db: DatabaseSchema, user: User, amount: number, reason: string, ref?: string): void {
  user.coins = Math.max(0, Math.round(((user.coins || 0) + amount) * 100) / 100);
  db.coinTx.unshift({ id: newId('ctx'), userId: user.id, amount, balanceAfter: user.coins, reason, ref, createdAt: new Date().toISOString() });
  if (db.coinTx.length > 20000) db.coinTx.length = 20000;
}
