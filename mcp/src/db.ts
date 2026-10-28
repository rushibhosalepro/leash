// Local agent log in Bun's built-in SQLite: every payment attempt the agent makes, including ones that fail
// before reaching the chain or revert (those leave no contract event), plus free-form notes the agent attaches.
// The chain stays the source of truth for what was paid, held or blocked; this adds what the chain cannot show.
import { Database } from 'bun:sqlite'
import { fileURLToPath } from 'node:url'

const db = new Database(fileURLToPath(new URL('../leash.db', import.meta.url)), { create: true })
db.exec(`
  CREATE TABLE IF NOT EXISTS attempts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    vault       TEXT NOT NULL,
    payee       TEXT NOT NULL,
    payee_name  TEXT,
    amount_usdc TEXT NOT NULL,
    reason      TEXT NOT NULL,
    outcome     TEXT NOT NULL,          -- paid | held | blocked | failed
    payment_id  TEXT,                   -- the contract's id, when the payment reached the chain
    tx_hash     TEXT,
    error       TEXT,                   -- why it failed, for outcome = failed
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE TABLE IF NOT EXISTS notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id  INTEGER NOT NULL REFERENCES attempts(id),
    note        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS attempts_vault ON attempts(vault);
`)

export interface Attempt {
  id: number; vault: string; payee: string; payee_name: string | null; amount_usdc: string; reason: string
  outcome: string; payment_id: string | null; tx_hash: string | null; error: string | null; created_at: string
}

export function logAttempt(a: Omit<Attempt, 'id' | 'created_at'>): number {
  const row = db.query(`INSERT INTO attempts (vault, payee, payee_name, amount_usdc, reason, outcome, payment_id, tx_hash, error)
    VALUES ($vault, $payee, $payee_name, $amount_usdc, $reason, $outcome, $payment_id, $tx_hash, $error) RETURNING id`)
    .get({ $vault: a.vault, $payee: a.payee, $payee_name: a.payee_name, $amount_usdc: a.amount_usdc, $reason: a.reason,
      $outcome: a.outcome, $payment_id: a.payment_id, $tx_hash: a.tx_hash, $error: a.error }) as { id: number }
  return row.id
}

export function addNote(attemptId: number, note: string) {
  db.query('INSERT INTO notes (attempt_id, note) VALUES ($a, $n)').run({ $a: attemptId, $n: note })
}

/** Finds an attempt by the contract's payment id, a tx hash, or the log's own attempt id ("a12"). */
export function findAttempt(vault: string, ref: string): Attempt | null {
  const q = ref.startsWith('a') ? 'SELECT * FROM attempts WHERE vault = $v AND id = $r'
    : ref.startsWith('0x') ? 'SELECT * FROM attempts WHERE vault = $v AND lower(tx_hash) = lower($r)'
      : 'SELECT * FROM attempts WHERE vault = $v AND payment_id = $r'
  return (db.query(q).get({ $v: vault, $r: ref.startsWith('a') ? Number(ref.slice(1)) : ref }) as Attempt | null) ?? null
}

export function recentAttempts(vault: string, limit = 200) {
  const attempts = db.query('SELECT * FROM attempts WHERE vault = $v ORDER BY id DESC LIMIT $l').all({ $v: vault, $l: limit }) as Attempt[]
  const notes = db.query(`SELECT attempt_id, note, created_at FROM notes WHERE attempt_id IN
    (SELECT id FROM attempts WHERE vault = $v ORDER BY id DESC LIMIT $l) ORDER BY id`).all({ $v: vault, $l: limit }) as
    { attempt_id: number; note: string; created_at: string }[]
  return attempts.map(a => ({ ...a, notes: notes.filter(n => n.attempt_id === a.id).map(n => ({ note: n.note, at: n.created_at })) }))
}
