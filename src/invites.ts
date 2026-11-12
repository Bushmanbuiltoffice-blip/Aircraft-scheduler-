import { newToken, sha256Hex, UNUSABLE_PASSWORD_HASH } from "./auth";
import { mapUser } from "./db";
import { ORG_NAME, type User } from "./types";

export const INVITE_DAYS = 7;

export type InviteStatus = { state: "invited"; expiresAt: string } | { state: "active" } | { state: "none" };

export type InviteLookup =
  | { ok: true; inviteId: string; user: User; expiresAt: string }
  | { ok: false; reason: "missing" | "used" | "revoked" | "expired" | "removed" };

/** A login works when the stored hash is a real password hash. */
export function hasWorkingLogin(user: Pick<User, "passwordHash" | "email">): boolean {
  return Boolean(user.email) && user.passwordHash !== UNUSABLE_PASSWORD_HASH && user.passwordHash.startsWith("pbkdf2$");
}

export function inviteTokenHash(token: string): Promise<string> {
  return sha256Hex(`invite:${token}`);
}

/**
 * Creates a fresh single-use invite and revokes any older unused ones for the
 * same person. Returns the raw token; only its hash is stored.
 */
export async function createInvite(
  db: D1Database,
  input: { userId: string; createdBy: string; now?: Date; days?: number },
): Promise<{ token: string; expiresAt: string }> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + (input.days ?? INVITE_DAYS) * 86_400_000).toISOString();
  const token = newToken();
  await db.batch([
    db
      .prepare("UPDATE invites SET revoked_at = ? WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL")
      .bind(nowIso, input.userId),
    db
      .prepare(
        `INSERT INTO invites (id, user_id, token_hash, expires_at, used_at, revoked_at, created_by, created_at)
         SELECT ?, ?, ?, ?, NULL, NULL, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND deleted_at IS NULL)`,
      )
      .bind(crypto.randomUUID(), input.userId, await inviteTokenHash(token), expiresAt, input.createdBy, nowIso, input.userId),
  ]);
  return { token, expiresAt };
}

export async function lookupInvite(db: D1Database, token: string, now = new Date()): Promise<InviteLookup> {
  if (!token || token.length > 200) return { ok: false, reason: "missing" };
  const row = await db
    .prepare(
      `SELECT i.id AS invite_id, i.expires_at AS invite_expires_at, i.used_at AS invite_used_at,
              i.revoked_at AS invite_revoked_at, u.*
       FROM invites i JOIN users u ON u.id = i.user_id
       WHERE i.token_hash = ?`,
    )
    .bind(await inviteTokenHash(token))
    .first<Record<string, unknown>>();
  if (!row) return { ok: false, reason: "missing" };
  if (row.deleted_at) return { ok: false, reason: "removed" };
  if (row.invite_used_at) return { ok: false, reason: "used" };
  if (row.invite_revoked_at) return { ok: false, reason: "revoked" };
  const expiresAt = String(row.invite_expires_at);
  if (expiresAt <= now.toISOString()) return { ok: false, reason: "expired" };
  return { ok: true, inviteId: String(row.invite_id), user: mapUser(row as never), expiresAt };
}

/**
 * Marks the invite used, saves the email and password, and signs the person
 * out everywhere, in one transaction. Returns false if the invite was used,
 * revoked, or expired in the meantime. A duplicate email throws a unique error
 * and nothing is saved.
 */
export async function redeemInvite(
  db: D1Database,
  input: { inviteId: string; userId: string; email: string; passwordHash: string; now?: Date },
): Promise<boolean> {
  const nowIso = (input.now ?? new Date()).toISOString();
  const consumed = "EXISTS (SELECT 1 FROM invites WHERE id = ? AND user_id = ? AND used_at = ?)";
  const results = await db.batch([
    db
      .prepare(
        `UPDATE invites SET used_at = ?
         WHERE id = ? AND user_id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?
           AND EXISTS (SELECT 1 FROM users WHERE id = ? AND deleted_at IS NULL)`,
      )
      .bind(nowIso, input.inviteId, input.userId, nowIso, input.userId),
    db
      .prepare(`UPDATE users SET email = ?, password_hash = ? WHERE id = ? AND deleted_at IS NULL AND ${consumed}`)
      .bind(input.email, input.passwordHash, input.userId, input.inviteId, input.userId, nowIso),
    db.prepare(`DELETE FROM sessions WHERE user_id = ? AND ${consumed}`).bind(input.userId, input.inviteId, input.userId, nowIso),
    db
      .prepare(`UPDATE invites SET revoked_at = ? WHERE user_id = ? AND id != ? AND used_at IS NULL AND revoked_at IS NULL AND ${consumed}`)
      .bind(nowIso, input.userId, input.inviteId, input.inviteId, input.userId, nowIso),
  ]);
  return Number(results[0]?.meta.changes ?? 0) === 1;
}

/** Current pending invite per person, for the People list. */
export async function pendingInvites(db: D1Database, now = new Date()): Promise<Map<string, string>> {
  const { results } = await db
    .prepare(
      `SELECT user_id, MAX(expires_at) AS expires_at FROM invites
       WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > ?
       GROUP BY user_id`,
    )
    .bind(now.toISOString())
    .all<{ user_id: string; expires_at: string }>();
  return new Map(results.map((row) => [row.user_id, row.expires_at]));
}

export async function revokeInvitesFor(db: D1Database, userId: string, now = new Date()): Promise<void> {
  await db
    .prepare("UPDATE invites SET revoked_at = ? WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL")
    .bind(now.toISOString(), userId)
    .run();
}

export function inviteMessage(url: string): string {
  return `You're invited to ${ORG_NAME}. Set your password here: ${url}`;
}

export function smsHref(phone: string | null, message: string): string {
  const number = (phone ?? "").replace(/[^0-9+]/g, "");
  return `sms:${number}?&body=${encodeURIComponent(message)}`;
}

export function mailtoHref(email: string, message: string): string {
  return `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}?subject=${encodeURIComponent(`Your ${ORG_NAME} login`)}&body=${encodeURIComponent(message)}`;
}
