import { createHash } from "node:crypto";
import type { EntityManager, DeepPartial } from "typeorm";
import { ActionHistory } from "../action-history/entities/action-history.entity";
import { MAX_JSONB_SIZE_BYTES } from "../action-history/history-limits";
import { accrualErrors } from "./accrual-errors";
import { requireAccrualOwner } from "./accrual-source";
import {
  AccrualHistoryChunk,
  ACCRUAL_HISTORY_CHUNK_BYTES,
  type AccrualHistorySide,
} from "./entities/accrual-history-chunk.entity";

type Data = Record<string, any> | null;
type Manifest = {
  accrualHistoryPayload: {
    version: 1;
    bytes: number;
    parts: number;
    sha256: string;
  };
};
type EncodedSide = { value: Data; parts: Buffer[] };
const hash = (value: Buffer) =>
  createHash("sha256").update(value).digest("hex");
const sides = ["before", "after"] as const;
const PAYLOAD_KIND = "accrual_history_v1";
const field = (side: AccrualHistorySide) =>
  side === "before" ? "beforeData" : "afterData";

function hasManifest(value: unknown): value is Manifest {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.prototype.hasOwnProperty.call(value, "accrualHistoryPayload")
  );
}
function encode(value: Data, external: boolean): EncodedSide {
  if (value === null || !external) return { value, parts: [] };
  const bytes = Buffer.from(JSON.stringify(value), "utf8");
  const parts: Buffer[] = [];
  for (
    let offset = 0;
    offset < bytes.length;
    offset += ACCRUAL_HISTORY_CHUNK_BYTES
  )
    parts.push(bytes.subarray(offset, offset + ACCRUAL_HISTORY_CHUNK_BYTES));
  return {
    value: {
      accrualHistoryPayload: {
        version: 1,
        bytes: bytes.length,
        parts: parts.length,
        sha256: hash(bytes),
      },
    },
    parts,
  };
}
function encodeSides(before: Data, after: Data) {
  const length = (value: Data) =>
    value === null ? 0 : Buffer.byteLength(JSON.stringify(value), "utf8");
  const external = length(before) + length(after) > MAX_JSONB_SIZE_BYTES;
  return { before: encode(before, external), after: encode(after, external) };
}
async function writeParts(
  m: EntityManager,
  userId: string,
  actionId: string,
  values: ReturnType<typeof encodeSides>,
): Promise<void> {
  for (const side of sides) {
    const parts = values[side].parts;
    if (!parts.length) continue;
    // One bounded row per part; the INSERT shares the source/history transaction.
    for (let offset = 0; offset < parts.length; offset += 128) {
      await m.getRepository(AccrualHistoryChunk).insert(
        parts.slice(offset, offset + 128).map((payload, index) => ({
          actionId,
          userId,
          side,
          partIndex: offset + index,
          payload,
        })),
      );
    }
  }
}
async function decode(
  m: EntityManager,
  action: ActionHistory,
  side: AccrualHistorySide,
): Promise<Data> {
  const value = action[field(side)];
  if (!hasManifest(value)) return value;
  const manifest = value.accrualHistoryPayload;
  if (
    Object.keys(value).length !== 1 ||
    !manifest ||
    manifest.version !== 1 ||
    !Number.isSafeInteger(manifest.bytes) ||
    manifest.bytes < 1 ||
    !Number.isSafeInteger(manifest.parts) ||
    manifest.parts !==
      Math.ceil(manifest.bytes / ACCRUAL_HISTORY_CHUNK_BYTES) ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256)
  )
    throw accrualErrors.historyIncomplete();
  const parts = await m.getRepository(AccrualHistoryChunk).find({
    where: { actionId: action.id, userId: action.userId, side },
    order: { partIndex: "ASC" },
  });
  if (
    parts.length !== manifest.parts ||
    parts.some(
      (part, index) =>
        part.partIndex !== index ||
        !Buffer.isBuffer(part.payload) ||
        part.payload.length < 1 ||
        part.payload.length > ACCRUAL_HISTORY_CHUNK_BYTES,
    )
  )
    throw accrualErrors.historyIncomplete();
  const bytes = Buffer.concat(parts.map((part) => part.payload));
  if (bytes.length !== manifest.bytes || hash(bytes) !== manifest.sha256)
    throw accrualErrors.historyIncomplete();
  try {
    const decoded: unknown = JSON.parse(bytes.toString("utf8"));
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded))
      throw accrualErrors.historyIncomplete();
    return decoded as Data;
  } catch {
    throw accrualErrors.historyIncomplete();
  }
}

/** Preserve the public kind without fetching private parts. Older records are unchanged. */
export function presentAccrualHistoryAction(
  action: ActionHistory,
): ActionHistory {
  if (action.entityType !== PAYLOAD_KIND || !action.accrualEntityType)
    return action;
  return Object.assign(new ActionHistory(), action, {
    entityType: action.accrualEntityType,
  });
}

/** Legacy inline records issue no extra query; new required records retain owner checks. */
export async function loadAccrualHistoryPayload(
  m: EntityManager,
  action: ActionHistory,
): Promise<ActionHistory> {
  if (
    action.entityType !== PAYLOAD_KIND &&
    !hasManifest(action.beforeData) &&
    !hasManifest(action.afterData)
  )
    return action;
  if (
    action.entityType === PAYLOAD_KIND &&
    (!action.accrualEntityType || action.accrualEntityType === PAYLOAD_KIND)
  )
    throw accrualErrors.historyIncomplete();
  requireAccrualOwner(action.userId);
  const beforeData = await decode(m, action, "before");
  const afterData = await decode(m, action, "after");
  return m
    .getRepository(ActionHistory)
    .create({ ...presentAccrualHistoryAction(action), beforeData, afterData });
}

/** Required history only: callers clear redo last and share their scoped transaction. */
export async function saveRequiredAccrualHistory(
  m: EntityManager,
  input: DeepPartial<ActionHistory> & { userId: string; entityType: string },
): Promise<void> {
  requireAccrualOwner(input.userId);
  const values = encodeSides(
    (input.beforeData ?? null) as Data,
    (input.afterData ?? null) as Data,
  );
  const repo = m.getRepository(ActionHistory);
  const action = await repo.save(
    repo.create({
      ...input,
      entityType: PAYLOAD_KIND,
      accrualEntityType: input.entityType,
      beforeData: values.before.value,
      afterData: values.after.value,
    }),
  );
  await writeParts(m, input.userId, action.id, values);
}

/** Parent CAS precedes child replacement, matching pruning/redo-clear cascade order. */
export async function replaceAccrualHistorySide(
  m: EntityManager,
  action: ActionHistory,
  side: "beforeData" | "afterData",
  value: Record<string, unknown>,
): Promise<void> {
  requireAccrualOwner(action.userId);
  const stored = await m
    .getRepository(ActionHistory)
    .findOne({ where: { id: action.id, userId: action.userId } });
  if (!stored || stored.isUndone !== (action.isUndone ?? false))
    throw accrualErrors.conflict();
  const current = await loadAccrualHistoryPayload(m, stored);
  const wanted = {
    beforeData: current.beforeData,
    afterData: current.afterData,
    [side]: value,
  };
  const values = encodeSides(wanted.beforeData, wanted.afterData);
  const result = await m
    .createQueryBuilder()
    .update(ActionHistory)
    .set({
      entityType: PAYLOAD_KIND,
      accrualEntityType: current.entityType,
      beforeData: values.before.value,
      afterData: values.after.value,
    })
    .where("id=:id AND user_id=:userId AND is_undone=:isUndone", {
      id: action.id,
      userId: action.userId,
      isUndone: action.isUndone ?? false,
    })
    .execute();
  if (result.affected !== 1) throw accrualErrors.conflict();
  if (hasManifest(stored.beforeData) || hasManifest(stored.afterData))
    await m
      .getRepository(AccrualHistoryChunk)
      .delete({ actionId: action.id, userId: action.userId });
  await writeParts(m, action.userId, action.id, values);
}
