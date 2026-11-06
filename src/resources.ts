/** Reference documents on the Resources tab. */

export const RESOURCE_CHUNK_BYTES = 512 * 1024;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const REFERENCE_NOTE = "Reference copy only. The FAA-approved manual stays in the airplane.";

export type ResourceStorage = "asset" | "d1";

export interface Resource {
  id: string;
  title: string;
  aircraftId: string | null;
  tailNumber: string | null;
  aircraftLabel: string | null;
  notes: string | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  storage: ResourceStorage;
  storageKey: string;
  createdAt: string;
}

type ResourceRow = {
  id: string;
  title: string;
  aircraft_id: string | null;
  tail_number: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  notes: string | null;
  file_name: string;
  content_type: string;
  size_bytes: number;
  storage: ResourceStorage;
  storage_key: string;
  created_at: string;
};

const SELECT = `SELECT r.*, a.tail_number, a.make, a.model, a.year
  FROM resources r LEFT JOIN aircraft a ON a.id = r.aircraft_id`;

function mapResource(row: ResourceRow): Resource {
  const label = row.tail_number
    ? `${row.tail_number} · ${[row.year, row.make, row.model].filter(Boolean).join(" ")}`.trim()
    : null;
  return {
    id: row.id,
    title: row.title,
    aircraftId: row.aircraft_id,
    tailNumber: row.tail_number,
    aircraftLabel: label,
    notes: row.notes,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    storage: row.storage,
    storageKey: row.storage_key,
    createdAt: row.created_at,
  };
}

export async function listResources(db: D1Database): Promise<Resource[]> {
  const { results } = await db
    .prepare(`${SELECT} ORDER BY a.tail_number IS NULL, a.tail_number, r.sort_order, r.title`)
    .all<ResourceRow>();
  return results.map(mapResource);
}

export async function getResource(db: D1Database, id: string): Promise<Resource | null> {
  const row = await db.prepare(`${SELECT} WHERE r.id = ?`).bind(id).first<ResourceRow>();
  return row ? mapResource(row) : null;
}

export type ResourceGroup = { key: string; label: string; items: Resource[] };

/** Groups by airplane (in tail-number order), with general documents last. */
export function groupResources(resources: Resource[]): ResourceGroup[] {
  const groups = new Map<string, ResourceGroup>();
  for (const item of resources) {
    const key = item.aircraftId && item.aircraftLabel ? item.aircraftId : "general";
    const label = key === "general" ? "General" : (item.aircraftLabel ?? "General");
    const group = groups.get(key) ?? { key, label, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  const list = [...groups.values()];
  return [...list.filter((g) => g.key !== "general"), ...list.filter((g) => g.key === "general")];
}

export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

/** A safe ASCII file name ending in .pdf. */
export function safePdfName(name: string): string {
  const base = name.replace(/\.pdf$/i, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return `${base || "document"}.pdf`;
}

type Base64Bytes = Uint8Array & { toBase64(): string };
type Base64Ctor = { fromBase64(text: string): Uint8Array };

function toBase64(bytes: Uint8Array): string {
  return (bytes as Base64Bytes).toBase64();
}

function fromBase64(text: string): Uint8Array {
  return (Uint8Array as unknown as Base64Ctor).fromBase64(text);
}

export async function createUploadedResource(
  db: D1Database,
  input: { title: string; aircraftId: string | null; notes: string | null; fileName: string; bytes: Uint8Array; createdBy: string },
): Promise<string> {
  const id = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO resources (id, title, aircraft_id, notes, file_name, content_type, size_bytes, storage, storage_key, sort_order, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, 'application/pdf', ?, 'd1', ?, 100, ?, ?)`,
      )
      .bind(id, input.title, input.aircraftId, input.notes, safePdfName(input.fileName), input.bytes.length, id, input.createdBy, new Date().toISOString()),
  ];
  for (let seq = 0, offset = 0; offset < input.bytes.length; seq += 1, offset += RESOURCE_CHUNK_BYTES) {
    const chunk = input.bytes.subarray(offset, offset + RESOURCE_CHUNK_BYTES);
    statements.push(db.prepare("INSERT INTO resource_chunks (resource_id, seq, data) VALUES (?, ?, ?)").bind(id, seq, toBase64(chunk)));
  }
  await db.batch(statements);
  return id;
}

export async function deleteResource(db: D1Database, id: string): Promise<boolean> {
  const [, result] = await db.batch([
    db.prepare("DELETE FROM resource_chunks WHERE resource_id = ?").bind(id),
    db.prepare("DELETE FROM resources WHERE id = ?").bind(id),
  ]);
  return (result?.meta.changes ?? 0) > 0;
}

/** Streams an uploaded PDF back out of D1, a few chunks per query. */
export function streamChunks(db: D1Database, id: string): ReadableStream<Uint8Array> {
  let next = 0;
  let pending: Uint8Array[] = [];
  let done = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!pending.length && !done) {
        const { results } = await db
          .prepare("SELECT seq, data FROM resource_chunks WHERE resource_id = ? AND seq >= ? ORDER BY seq LIMIT 4")
          .bind(id, next)
          .all<{ seq: number; data: string }>();
        if (!results.length) done = true;
        for (const row of results) {
          pending.push(fromBase64(row.data));
          next = row.seq + 1;
        }
      }
      const chunk = pending.shift();
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
  });
}

export function contentDisposition(kind: "inline" | "attachment", fileName: string): string {
  return `${kind}; filename="${safePdfName(fileName)}"`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
