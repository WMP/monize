import { Inject, Injectable, forwardRef } from "@nestjs/common";
import { ArrayContains, EntityManager, In } from "typeorm";
import { Account } from "../accounts/entities/account.entity";
import { Category } from "../categories/entities/category.entity";
import { Payee } from "../payees/entities/payee.entity";
import { PayeesService } from "../payees/payees.service";
import { Tag } from "../tags/entities/tag.entity";
import { TransactionTag } from "../tags/entities/transaction-tag.entity";
import { AiReviewRequestsService } from "../ai-review/ai-review-requests.service";
import { TagsService } from "../tags/tags.service";
import { Transaction } from "../transactions/entities/transaction.entity";
import {
  PayeeResolution,
  PayeeResolutions,
  PlannableRule,
  RuleEffects,
  RulePlanContext,
  RuleTraceEntry,
  hasRuleEffects,
  payeeLookupKey,
  planRuleEffects,
  recordAiReviewAlreadyQueued,
  recordAiReviewQueued,
} from "./rule-effects";
import {
  RuleFactsInput,
  buildRuleFacts,
  loadCategoryChains,
} from "./rule-facts";
import { loadRuleTargetAccounts } from "./rule-target-accounts";
import { toRuleResponses } from "./transaction-rule-view";
import {
  RuleApplicationSource,
  TransactionRuleApplication,
} from "./transaction-rule-application.entity";
import { TransactionRule } from "./transaction-rule.entity";
import { RuleTrigger } from "./rule-trigger.types";

/** What the applier changed on one row. */
export interface AppliedRuleRow {
  readonly transactionId: string;
  readonly effects: RuleEffects;
}

/** The two stored legs of a transfer just written, and who owns each. */
export interface NewTransferLegs {
  readonly fromLegId: string;
  readonly toLegId: string;
  readonly fromOwnerId: string;
  readonly toOwnerId: string;
}

export interface ApplyToNewOptions {
  /** Rules already loaded for this call (an import loads them once per file). */
  readonly rules?: readonly TransactionRule[];
  /**
   * The raw payee text per transaction id, when the source has it. A row not
   * named here falls back to its stored `payee_name`.
   */
  readonly payeeTextById?: ReadonlyMap<string, string | null>;
}

/**
 * Names for the ids in a preview, so a confirmation card shows a category, a
 * payee, a tag and a rule by name and never an id.
 */
export interface RuleEffectsLabels {
  /** Account names of the targets a structural action's plan names. */
  readonly accounts: Readonly<Record<string, string>>;
  readonly categories: Readonly<Record<string, string>>;
  readonly payees: Readonly<Record<string, string>>;
  readonly tags: Readonly<Record<string, string>>;
  readonly rules: Readonly<Record<string, string>>;
}

/** The plan a preview returns: exactly what the commit will write, plus names. */
export interface RuleEffectsPreview extends RuleEffects {
  readonly labels: RuleEffectsLabels;
}

/**
 * The facts of a row that is not stored yet (the preview) or just stored.
 * `payeeName` is the name stored on the row, for the trace of a payee change
 * only; no condition reads it (`payeeText` is the fact).
 */
export type RuleRowInput = Omit<RuleFactsInput, "categoryAncestorIds"> & {
  readonly payeeName?: string | null;
};

/**
 * The X3 facts of a row this applier has just been handed: reference number,
 * date and status from the stored row. A row written in this transaction has
 * no attachment yet (nothing can attach to a row before it exists), so
 * `hasAttachment` is false, the same answer the preview gives for a row that
 * is not stored.
 */
function storedRowFacts(
  row: Pick<Transaction, "referenceNumber" | "transactionDate" | "status">,
): Pick<
  RuleFactsInput,
  "referenceNumber" | "transactionDate" | "status" | "hasAttachment"
> {
  return {
    referenceNumber: row.referenceNumber,
    transactionDate: row.transactionDate,
    status: row.status,
    hasAttachment: false,
  };
}

/** What a caller knows about the row besides its facts: transfer ownership and the target accounts. */
export type PlanRowContext = Pick<
  RulePlanContext,
  "crossOwnerTransferLeg" | "accounts"
>;

/** Payee lookups made while planning; share one across the rows of a call. */
export type PayeeLookupCache = Map<string, PayeeResolution | null>;

/**
 * Planning rounds for payee lookups. Each round looks up the names the last
 * plan needed and plans again; a rule list needs one or two.
 */
const MAX_PAYEE_LOOKUP_ROUNDS = 12;

/**
 * Applies a user's transaction rules to rows in the caller's transaction
 * (design 6.3). It never opens its own transaction: every read and write goes
 * through the `EntityManager` it is handed, so a rollback of the insert rolls
 * back the rule effects (INV-RULE-002). It changes only category, payee and
 * tags -- never amount, account, date, status or a link (INV-RULE-001). A
 * `request_ai_review` action is queued through the same manager
 * (`queueAiReviews`), so it is written or dropped with the row that asked.
 */
@Injectable()
export class TransactionRulesApplierService {
  constructor(
    private readonly tagsService: TagsService,
    private readonly aiReviewRequests: AiReviewRequestsService,
    // forwardRef: PayeesModule reaches this module back through TransactionsModule.
    @Inject(forwardRef(() => PayeesService))
    private readonly payeesService: PayeesService,
  ) {}

  /**
   * The user's enabled rules for a trigger, in `position` order, without the
   * ones that no longer validate or name an id that is gone (the trace of such
   * a rule would only say "invalid").
   */
  async loadRulesFor(
    m: EntityManager,
    userId: string,
    trigger: RuleTrigger,
  ): Promise<TransactionRule[]> {
    const rules = await m.getRepository(TransactionRule).find({
      where: { userId, enabled: true, triggers: ArrayContains([trigger]) },
      order: { position: "ASC" },
    });
    if (rules.length === 0) return [];
    const views = await toRuleResponses(m, userId, rules);
    const usable = new Set(views.filter((v) => !v.invalid).map((v) => v.id));
    return rules.filter((rule) => usable.has(rule.id));
  }

  /**
   * Plan one row that is not (or not yet) stored. The one planning path: the
   * preview calls it directly and `applyToNew` calls it per stored row, so a
   * preview shows what the commit writes (design I3).
   */
  async planForRow(
    m: EntityManager,
    userId: string,
    input: RuleRowInput,
    rules: readonly TransactionRule[],
    context: PlanRowContext = {},
  ): Promise<RuleEffects> {
    if (rules.length === 0) return planRuleEffects(buildRuleFacts(input), []);
    const chains = await this.chainsFor(m, userId, rules, [input.categoryId]);
    const accounts = await loadRuleTargetAccounts(m, userId, rules);
    return this.planResolved(userId, input, rules, chains, {
      ...context,
      accounts,
    });
  }

  /**
   * `planWithChains` with the payee lookups the plan asks for: a
   * `set_payee_from_text` renders its name from the rule's captures, so the
   * name is known only while planning. The names the plan reports are looked
   * up through the payee service's `resolveByName` (exact name, alias, unique
   * normalized match) and the plan runs again, until it needs no more. The
   * preview never creates a payee; a name nobody has stays a
   * `payeeCreated` note on the plan. `cache` is shared by the rows of one
   * call so a batch looks each name up once.
   */
  async planResolved(
    userId: string,
    input: RuleRowInput,
    rules: readonly PlannableRule[],
    chains: ReadonlyMap<string, readonly string[]>,
    context: PlanRowContext,
    cache: PayeeLookupCache = new Map(),
  ): Promise<RuleEffects> {
    let effects = this.planWithChains(input, rules, chains, context, cache);
    for (
      let round = 0;
      round < MAX_PAYEE_LOOKUP_ROUNDS && effects.payeeLookups !== undefined;
      round++
    ) {
      const missing = effects.payeeLookups.filter(
        (name) => !cache.has(payeeLookupKey(name)),
      );
      if (missing.length === 0) break;
      for (const name of missing) {
        cache.set(payeeLookupKey(name), await this.lookUpPayee(userId, name));
      }
      effects = this.planWithChains(input, rules, chains, context, cache);
    }
    return effects;
  }

  private async lookUpPayee(
    userId: string,
    name: string,
  ): Promise<PayeeResolution | null> {
    const payee = await this.payeesService.resolveByName(userId, name);
    return payee === null ? null : { payeeId: payee.id, name: payee.name };
  }

  /**
   * The preview of a create: the plan for a row that is not stored, or null
   * when the user has no rule for the trigger or nothing matched. It loads the
   * rules and plans through `planForRow`, the same path `applyToNew` uses.
   */
  async previewForRow(
    m: EntityManager,
    userId: string,
    input: RuleRowInput,
    trigger: RuleTrigger = "create",
  ): Promise<RuleEffectsPreview | null> {
    const rules = await this.loadRulesFor(m, userId, trigger);
    if (rules.length === 0) return null;
    const effects = await this.planForRow(m, userId, input, rules);
    if (!hasRuleEffects(effects)) return null;
    return {
      ...effects,
      labels: await this.labelsFor(m, userId, effects, rules),
    };
  }

  /** Names for the ids the effects and their traces mention (public: the manual run labels a whole batch). */
  async labelsFor(
    m: EntityManager,
    userId: string,
    effects: RuleEffects,
    rules: readonly (PlannableRule & { name?: string })[],
  ): Promise<RuleEffectsLabels> {
    const categoryIds = new Set<string>();
    const payeeIds = new Set<string>();
    const accountIds = new Set<string>();
    const tagIds = new Set<string>([
      ...effects.changes.addTagIds,
      ...effects.changes.removeTagIds,
    ]);
    const structures = [
      effects.changes.structure,
      ...effects.trace.map((entry) => entry.changes.structure?.after),
    ];
    for (const structure of structures) {
      if (!structure) continue;
      if (structure.kind === "transfer") accountIds.add(structure.accountId);
      else {
        for (const part of structure.parts) {
          if (part.categoryId) categoryIds.add(part.categoryId);
          if (part.transferAccountId) accountIds.add(part.transferAccountId);
          if (part.payeeId) payeeIds.add(part.payeeId);
        }
      }
    }
    for (const entry of effects.trace) {
      const { categoryId, payeeId, tagIds: tags } = entry.changes;
      for (const id of [categoryId?.before, categoryId?.after])
        if (id) categoryIds.add(id);
      for (const id of [payeeId?.before, payeeId?.after])
        if (id) payeeIds.add(id);
      for (const id of [...(tags?.before ?? []), ...(tags?.after ?? [])])
        tagIds.add(id);
    }
    const names = async (
      entity: typeof Account | typeof Category | typeof Payee | typeof Tag,
      ids: Set<string>,
    ): Promise<Record<string, string>> => {
      if (ids.size === 0) return {};
      const found = (await m.find(entity as typeof Category, {
        select: { id: true, name: true },
        where: { id: In([...ids]), userId },
      })) as Array<{ id: string; name: string }>;
      return Object.fromEntries(found.map((row) => [row.id, row.name]));
    };
    return {
      accounts: await names(Account, accountIds),
      categories: await names(Category, categoryIds),
      payees: await names(Payee, payeeIds),
      tags: await names(Tag, tagIds),
      rules: Object.fromEntries(
        rules
          .filter((rule) =>
            effects.trace.some((e) => e.ruleId === rule.id && e.matched),
          )
          .map((rule) => [rule.id, rule.name ?? rule.id]),
      ),
    };
  }

  /**
   * Apply the rules to rows just written in the caller's transaction. Returns
   * the rows a rule changed. Nothing is loaded or written when the user has no
   * rule for the trigger.
   */
  async applyToNew(
    m: EntityManager,
    userId: string,
    transactionIds: readonly string[],
    source: RuleApplicationSource,
    options: ApplyToNewOptions = {},
  ): Promise<AppliedRuleRow[]> {
    const ids = [...new Set(transactionIds)];
    if (ids.length === 0) return [];
    const rules =
      options.rules ??
      (await this.loadRulesFor(
        m,
        userId,
        source === "import" ? "import" : "create",
      ));
    if (rules.length === 0) return [];

    const rows = await m.find(Transaction, { where: { id: In(ids), userId } });
    const tagsByRow = await this.loadTagIds(m, ids);
    const chains = await this.chainsFor(
      m,
      userId,
      rules,
      rows.map((row) => row.categoryId),
    );

    const accounts = await loadRuleTargetAccounts(m, userId, rules);
    const applied: AppliedRuleRow[] = [];
    const lookups: PayeeLookupCache = new Map();
    for (const row of rows) {
      const { input, context } = await this.inputFromRow(
        m,
        userId,
        row,
        tagsByRow.get(row.id) ?? [],
        options.payeeTextById,
      );
      const planned = await this.planResolved(
        userId,
        input,
        rules,
        chains,
        { ...context, accounts },
        lookups,
      );
      const effects = await this.writeEffects(
        m,
        userId,
        row.id,
        planned,
        source,
      );
      // A payee this row created answers the lookups of the rows after it.
      if (planned.changes.createPayee !== undefined) lookups.clear();
      applied.push({ transactionId: row.id, effects });
    }
    return this.queueAiReviews(m, userId, applied);
  }

  /**
   * Apply the `create` rules to the legs of a transfer just written in the
   * caller's transaction (design 6.3). One evaluation per transfer per owner:
   *
   * - Same owner: evaluated once over the outgoing leg's facts, and the
   *   result is written to BOTH legs (tags mirrored the way `syncTransferTags`
   *   does, the payee on both). `set_category` is refused by the planner.
   * - Cross owner: each owner's rules run on that owner's leg only, and the
   *   other owner's leg is never read or written. The partner account is not
   *   put in the facts, and `set_payee` is refused (`crossOwnerTransferLeg`).
   *
   * Nothing is written when the owner has no rule for the trigger.
   */
  async applyToNewTransfer(
    m: EntityManager,
    legs: NewTransferLegs,
  ): Promise<AppliedRuleRow[]> {
    const sameOwner = legs.fromOwnerId === legs.toOwnerId;
    const applied: AppliedRuleRow[] = [];
    const evaluations: Array<{ ownerId: string; legIds: string[] }> = sameOwner
      ? [{ ownerId: legs.fromOwnerId, legIds: [legs.fromLegId, legs.toLegId] }]
      : [
          { ownerId: legs.fromOwnerId, legIds: [legs.fromLegId] },
          { ownerId: legs.toOwnerId, legIds: [legs.toLegId] },
        ];
    for (const { ownerId, legIds } of evaluations) {
      const rules = await this.loadRulesFor(m, ownerId, "create");
      if (rules.length === 0) continue;
      const rows = await m.find(Transaction, {
        where: { id: In(legIds), userId: ownerId },
      });
      const from = rows.find((row) => row.id === legs.fromLegId);
      const to = rows.find((row) => row.id === legs.toLegId);
      const primary = from ?? to;
      if (!primary) continue;
      const tagIds = (await this.loadTagIds(m, [primary.id])).get(primary.id);
      const chains = await this.chainsFor(m, ownerId, rules, [
        primary.categoryId,
      ]);
      const planned = await this.planResolved(
        ownerId,
        {
          accountId: primary.accountId,
          currencyCode: primary.currencyCode,
          amount: primary.amount,
          isTransfer: true,
          fromAccountId: from?.accountId ?? null,
          toAccountId: to?.accountId ?? null,
          payeeId: primary.payeeId,
          payeeText: primary.payeeName,
          payeeName: primary.payeeName,
          categoryId: primary.categoryId,
          description: primary.description,
          tagIds: tagIds ?? [],
          hasSplits: primary.isSplit,
          ...storedRowFacts(primary),
        },
        rules,
        chains,
        {
          crossOwnerTransferLeg: !sameOwner,
          accounts: await loadRuleTargetAccounts(m, ownerId, rules),
        },
      );
      // A payee the rules create is created once, for both legs.
      const effects = await this.resolveCreatedPayee(m, ownerId, planned);
      // One review request per transfer, on the outgoing leg (`primary`).
      const [queued] = await this.queueAiReviews(m, ownerId, [
        { transactionId: primary.id, effects },
      ]);
      for (const row of rows) {
        await this.writeEffects(m, ownerId, row.id, effects, "create");
        applied.push({ transactionId: row.id, effects: queued.effects });
      }
    }
    return applied;
  }

  /**
   * Queue the `request_ai_review` actions the plans collected, in the caller's
   * transaction and through one `enqueue` (the queue's partial unique index
   * dedupes a request already open for the same row and rule). Returns the
   * rows with a trace that says "queued", or "already_queued" where the
   * dedupe skipped it. The manual run calls it on commit, never on preview.
   */
  async queueAiReviews(
    m: EntityManager,
    userId: string,
    rows: readonly AppliedRuleRow[],
  ): Promise<AppliedRuleRow[]> {
    const requests = rows.flatMap((row) =>
      row.effects.aiReviewRequests.map((request) => ({
        transactionId: row.transactionId,
        ruleId: request.ruleId,
        instruction: request.instruction,
      })),
    );
    if (requests.length === 0) return [...rows];
    const { alreadyQueued } = await this.aiReviewRequests.enqueue(
      m,
      userId,
      requests,
    );
    return rows.map((row) => {
      const skipped = new Set(
        alreadyQueued
          .filter((key) => key.transactionId === row.transactionId)
          .map((key) => key.ruleId)
          .filter((id): id is string => id !== null),
      );
      return skipped.size === 0
        ? row
        : {
            transactionId: row.transactionId,
            effects: recordAiReviewAlreadyQueued(row.effects, skipped),
          };
    });
  }

  planWithChains(
    input: RuleRowInput,
    rules: readonly PlannableRule[],
    chains: ReadonlyMap<string, readonly string[]>,
    context: PlanRowContext,
    payeeResolutions?: PayeeResolutions,
  ): RuleEffects {
    const facts = buildRuleFacts({
      ...input,
      categoryAncestorIds:
        input.categoryId === null ? [] : chains.get(input.categoryId),
    });
    return recordAiReviewQueued(
      planRuleEffects(facts, rules, {
        ...context,
        categoryChains: chains,
        // A row not stored yet (the preview) has no stored name; the text the
        // create will store is the payee text, so the trace agrees with the commit.
        payeeName:
          input.payeeName !== undefined ? input.payeeName : input.payeeText,
        payeeResolutions,
      }),
    );
  }

  /** One query for the chains of the rows' categories and of every category a rule sets. */
  chainsFor(
    m: EntityManager,
    userId: string,
    rules: readonly PlannableRule[],
    rowCategoryIds: readonly (string | null)[],
  ): Promise<ReadonlyMap<string, readonly string[]>> {
    const wanted = new Set<string>();
    for (const id of rowCategoryIds) if (id) wanted.add(id);
    for (const rule of rules) {
      for (const action of rule.actions) {
        if (action.type === "set_category") wanted.add(action.categoryId);
      }
    }
    return loadCategoryChains(m, userId, [...wanted]);
  }

  async loadTagIds(
    m: EntityManager,
    transactionIds: readonly string[],
  ): Promise<Map<string, string[]>> {
    const links = await m.find(TransactionTag, {
      where: { transactionId: In([...transactionIds]) },
    });
    const byRow = new Map<string, string[]>();
    for (const link of links) {
      byRow.set(link.transactionId, [
        ...(byRow.get(link.transactionId) ?? []),
        link.tagId,
      ]);
    }
    return byRow;
  }

  /**
   * The facts input of a stored row. A transfer leg also needs the other
   * leg's account to say which way the money went; a partner leg the caller's
   * scope cannot read is another owner's, and the row is then treated as a
   * cross-owner leg (the safe side: `set_payee` is refused).
   */
  private async inputFromRow(
    m: EntityManager,
    userId: string,
    row: Transaction,
    tagIds: readonly string[],
    payeeTextById: ReadonlyMap<string, string | null> | undefined,
  ): Promise<{
    input: RuleRowInput;
    context: PlanRowContext;
  }> {
    let fromAccountId: string | null = null;
    let toAccountId: string | null = null;
    let crossOwnerTransferLeg = false;
    if (row.isTransfer) {
      const partner = row.linkedTransactionId
        ? await m.findOne(Transaction, {
            where: { id: row.linkedTransactionId, userId },
          })
        : null;
      crossOwnerTransferLeg = partner === null;
      const outgoing = Number(row.amount) < 0;
      fromAccountId = outgoing ? row.accountId : (partner?.accountId ?? null);
      toAccountId = outgoing ? (partner?.accountId ?? null) : row.accountId;
    }
    return {
      input: {
        accountId: row.accountId,
        currencyCode: row.currencyCode,
        amount: row.amount,
        isTransfer: row.isTransfer,
        fromAccountId,
        toAccountId,
        payeeId: row.payeeId,
        payeeText: payeeTextById?.has(row.id)
          ? (payeeTextById.get(row.id) ?? null)
          : row.payeeName,
        payeeName: row.payeeName,
        categoryId: row.categoryId,
        description: row.description,
        tagIds,
        hasSplits: row.isSplit,
        ...storedRowFacts(row),
      },
      context: { crossOwnerTransferLeg },
    };
  }

  /**
   * Turn a payee the plan wants created into an id, in the caller's
   * transaction: the payee service's `resolveByName` again (the plan was made
   * before this write), then its `findOrCreate` when still nobody has the
   * name. Returns the effects with `payeeId` / `payeeName` in place of
   * `createPayee`, and the trace carrying the payee's id; a plan that creates
   * nothing is returned as it is. A payee is reference data: the undo of a
   * manual run does not delete it.
   */
  async resolveCreatedPayee(
    m: EntityManager,
    userId: string,
    effects: RuleEffects,
  ): Promise<RuleEffects> {
    const name = effects.changes.createPayee;
    if (name === undefined) return effects;
    const existing = await this.payeesService.resolveByName(userId, name);
    const payee =
      existing ?? (await this.payeesService.findOrCreate(userId, name));
    const created = existing === null;
    // Only the last rule that asked for the creation owns its outcome.
    const lastAsking = effects.trace.reduce(
      (found, entry, i) => (entry.changes.payeeCreated ? i : found),
      -1,
    );
    const trace: RuleTraceEntry[] = effects.trace.map((entry, i) => {
      if (!entry.changes.payeeCreated) return entry;
      const { payeeCreated: _asked, ...rest } = entry.changes;
      if (i !== lastAsking) return { ...entry, changes: rest };
      return {
        ...entry,
        changes: {
          ...rest,
          payeeId: { before: rest.payeeId?.before ?? null, after: payee.id },
          payeeName: {
            before: rest.payeeName?.before ?? null,
            after: payee.name,
          },
          ...(created ? { payeeCreated: true } : {}),
        },
      };
    });
    const { createPayee: _create, ...rest } = effects.changes;
    return {
      ...effects,
      changes: { ...rest, payeeId: payee.id, payeeName: payee.name },
      trace,
    };
  }

  /**
   * Category, payee and description through the manager's parameterized
   * UPDATE, tags through TagsService, one trace row per rule. Returns the
   * effects as written (a payee the rules created now has its id).
   */
  async writeEffects(
    m: EntityManager,
    userId: string,
    transactionId: string,
    planned: RuleEffects,
    source: RuleApplicationSource,
  ): Promise<RuleEffects> {
    const effects = await this.resolveCreatedPayee(m, userId, planned);
    const { changes } = effects;
    const patch: Partial<
      Pick<Transaction, "categoryId" | "payeeId" | "payeeName" | "description">
    > = {
      ...(changes.categoryId !== undefined
        ? { categoryId: changes.categoryId }
        : {}),
      ...(changes.description !== undefined
        ? { description: changes.description }
        : {}),
    };
    if (changes.payeeId !== undefined) {
      const payee =
        changes.payeeId === null
          ? null
          : changes.payeeName !== undefined
            ? { name: changes.payeeName }
            : await m.findOne(Payee, {
                where: { id: changes.payeeId, userId },
              });
      Object.assign(patch, {
        payeeId: changes.payeeId,
        payeeName: payee?.name ?? null,
      });
    }
    if (Object.keys(patch).length > 0) {
      await m.update(Transaction, { id: transactionId, userId }, patch);
    }
    if (changes.addTagIds.length > 0) {
      await this.tagsService.addTransactionTags(
        m,
        userId,
        [transactionId],
        changes.addTagIds,
      );
    }
    if (changes.removeTagIds.length > 0) {
      await this.tagsService.removeTransactionTags(
        m,
        userId,
        [transactionId],
        changes.removeTagIds,
      );
    }
    const traceRows = effects.trace
      .filter((entry) => Object.keys(entry.changes).length > 0)
      .map((entry) => ({
        userId,
        ruleId: entry.ruleId,
        transactionId,
        source,
        changes: { ...entry.changes },
      }));
    if (traceRows.length > 0) {
      await m.insert(TransactionRuleApplication, traceRows);
    }
    return effects;
  }
}
