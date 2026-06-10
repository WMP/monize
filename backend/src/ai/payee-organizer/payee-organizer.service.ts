import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AiService } from "../ai.service";
import { PayeesService } from "../../payees/payees.service";
import { CategoriesService } from "../../categories/categories.service";
import { PayeeMergeRejection } from "../../payees/entities/payee-merge-rejection.entity";
import { PAYEE_ORGANIZER_SYSTEM_PROMPT } from "../context/prompt-templates";
import { sanitizePromptValue } from "../../common/sanitization.util";
import { SuggestPayeeOrganizationDto } from "./dto/suggest-payee-organization.dto";
import { ApplyPayeeOrganizationDto } from "./dto/apply-payee-organization.dto";

// How many uncategorized payees to send to the LLM in a single pass and how
// many sample transaction descriptions to attach per payee. Kept modest to
// bound prompt size and provider cost.
const MAX_PAYEES_PER_PASS = 300;
const DEFAULT_PAYEES_PER_RUN = 50;
const SAMPLE_DESCRIPTIONS_PER_PAYEE = 4;
const MAX_JSON_SIZE = 200 * 1024; // 200KB defence-in-depth cap

// Tokens that look like a city/location or pure noise and so must NOT define a
// merchant's identity when building the cluster key. Conservative, lowercased,
// already diacritic-stripped.
const LOCATION_NOISE_TOKENS = new Set<string>([
  "warszawa",
  "krakow",
  "wroclaw",
  "poznan",
  "gdansk",
  "gdynia",
  "lodz",
  "katowice",
  "szczecin",
  "lublin",
  "bydgoszcz",
  "bialystok",
  "sklep",
  "shop",
  "store",
  "market",
  "sp",
  "zoo",
  "sa",
  "ltd",
  "inc",
  "gmbh",
  "com",
  "pl",
]);

export interface PayeeCategorySuggestion {
  payeeId: string;
  payeeName: string;
  categoryId: string | null;
  categoryName: string;
  isNew: boolean;
  /** Recent transaction descriptions for this payee, so the UI can show context
   * and the user can judge the suggestion before applying. */
  sampleDescriptions: string[];
}

export interface PayeeMergeGroup {
  canonicalPayeeId: string;
  canonicalName: string;
  duplicates: Array<{ payeeId: string; name: string }>;
  reason: string;
}

/** A member of a unified review group (a payee in a cluster, or a singleton). */
export interface PayeeGroupMember {
  payeeId: string;
  payeeName: string;
  sampleDescriptions: string[];
  /** True when the payee already has a default category (so it does not need
   * one); only the surviving payee's category suggestion is offered. */
  hasCategory: boolean;
}

/** The AI's category suggestion for a group's surviving payee. */
export interface PayeeGroupCategory {
  categoryId: string | null;
  categoryName: string;
  isNew: boolean;
}

/**
 * One row in the unified payee organizer UI: either a single payee or a
 * cluster of likely-duplicates. The UI both merges duplicates and sets the
 * category for the surviving payee from this single structure.
 */
export interface PayeeGroup {
  /** canonicalPayeeId for clusters, else the single payee's id. */
  groupId: string;
  /** True when the group has >= 2 members (a likely-duplicate cluster). */
  isCluster: boolean;
  /** Default canonical (survivor) for the group. */
  suggestedCanonicalPayeeId: string;
  /** Why the cluster's members are considered the same merchant (clusters only). */
  mergeReason: string | null;
  members: PayeeGroupMember[];
  /** Category suggestion for the surviving payee, or null when none was
   * produced (e.g. survivor is already categorized). */
  category: PayeeGroupCategory | null;
}

export interface PayeeOrganizationSuggestion {
  /** Back-compat shape consumed by the MCP tool and AI assistant executor. */
  categorySuggestions: PayeeCategorySuggestion[];
  /** Back-compat shape consumed by the MCP tool and AI assistant executor. */
  mergeGroups: PayeeMergeGroup[];
  /** Unified cluster-and-singleton view consumed by the new organizer UI. */
  groups: PayeeGroup[];
  model: string;
  /** How many duplicate candidate clusters exist beyond those analysed this
   * run, so the UI can prompt the user to run "Find duplicates" again. */
  mergeCandidateClustersRemaining?: number;
}

export interface PayeeOrganizationApplyResult {
  categoriesCreated: number;
  payeesCategorized: number;
  payeesMerged: number;
  mergeRejectionsSaved: number;
}

@Injectable()
export class PayeeOrganizerService {
  private readonly logger = new Logger(PayeeOrganizerService.name);

  constructor(
    private readonly aiService: AiService,
    private readonly payeesService: PayeesService,
    private readonly categoriesService: CategoriesService,
    @InjectRepository(PayeeMergeRejection)
    private readonly mergeRejectionRepository: Repository<PayeeMergeRejection>,
  ) {}

  /**
   * Normalize an unordered payee pair into {low, high} by UUID string compare,
   * so {A,B} and {B,A} map to the same canonical representation.
   */
  private normalizePair(a: string, b: string): { low: string; high: string } {
    return a < b ? { low: a, high: b } : { low: b, high: a };
  }

  private pairKey(low: string, high: string): string {
    return `${low}|${high}`;
  }

  async suggest(
    userId: string,
    dto: SuggestPayeeOrganizationDto,
  ): Promise<PayeeOrganizationSuggestion> {
    const { allowNewCategories } = dto;
    const mode = dto.mode ?? "all";

    // Analyse one bounded slice per run so the prompt stays small enough for
    // providers with a low tokens-per-minute limit (e.g. Groq free tier). The
    // caller can lower `limit` further and run again for the next slice. For
    // the merge path this bounds how many candidate clusters we confirm.
    const limit = Math.min(
      dto.limit ?? DEFAULT_PAYEES_PER_RUN,
      MAX_PAYEES_PER_PASS,
    );

    // --- Build duplicate candidate clusters over ALL active payees ---
    // Merge must consider categorized payees too, so this path is independent
    // of the uncategorized slice used for category suggestions.
    const activePayees = await this.payeesService.findActivePayees(userId);
    const allCandidateClusters = await this.buildCandidateClusters(
      userId,
      activePayees,
    );
    // Biggest duplicate groups first; cap to `limit` clusters per run so the
    // prompt stays bounded. Applying/rejecting resolves clusters, so the next
    // run naturally surfaces the next ones (no offset needed).
    const orderedClusters = [...allCandidateClusters].sort(
      (a, b) => b.length - a.length,
    );
    const clustersThisRun = orderedClusters.slice(0, limit);
    const mergeCandidateClustersRemaining =
      orderedClusters.length - clustersThisRun.length;

    // --- Category-suggestion path (unchanged): uncategorized slice ---
    // Skip entirely in merge-only mode.
    const minTransactions = Math.max(0, dto.minTransactions ?? 0);
    const baseCategoryPayees =
      mode === "merge"
        ? []
        : await this.payeesService.findUncategorizedActiveWithSamples(
            userId,
            limit,
            SAMPLE_DESCRIPTIONS_PER_PAYEE,
            minTransactions,
          );

    // The category pass must also cover the SURVIVORS of duplicate clusters:
    // every member of a cluster this run that is uncategorized (whichever the
    // AI later picks as canonical may need a category). Augment the slice with
    // those cluster members that are not already present, so the prompt offers
    // a category for them too. Singletons are already covered by the slice.
    const categoryPayees =
      mode === "merge"
        ? []
        : await this.augmentCategoryPayeesWithClusters(
            userId,
            baseCategoryPayees,
            clustersThisRun,
          );

    // Nothing to do at all: no clusters to confirm and (in 'all' mode) no
    // uncategorized payees to categorize.
    if (clustersThisRun.length === 0 && categoryPayees.length === 0) {
      return {
        categorySuggestions: [],
        mergeGroups: [],
        groups: [],
        model: "none",
        mergeCandidateClustersRemaining: 0,
      };
    }

    // In merge-only mode we never categorize, so skip the (token-heavy)
    // category list entirely.
    const categories =
      mode === "merge"
        ? []
        : (
            await this.categoriesService.getLlmCategories(userId, {
              type: "all",
            })
          ).categories;

    const prompt = this.buildPrompt(
      categoryPayees,
      categories,
      allowNewCategories,
      mode,
      clustersThisRun,
    );

    const response = await this.aiService.complete(
      userId,
      {
        systemPrompt: PAYEE_ORGANIZER_SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
        maxTokens: 8192,
        temperature: 0.1,
        responseFormat: "json",
      },
      "payee-organizer",
    );

    const parsed = this.parseResponse(response.content, userId);

    // Build lookup sets for validation against real, owned data.
    const categoryPayeeNameById = new Map(
      categoryPayees.map((p) => [p.payeeId, p.payeeName]),
    );
    const payeeSamplesById = new Map(
      categoryPayees.map((p) => [p.payeeId, p.sampleDescriptions]),
    );
    const ownedCategoryById = new Map(categories.map((c) => [c.id, c.name]));

    // The merge groups may only reference payees we actually offered as
    // candidates this run, so validate against the candidate payee set.
    const candidateNameById = new Map<string, string>();
    for (const cluster of clustersThisRun) {
      for (const member of cluster) {
        candidateNameById.set(member.id, member.name);
      }
    }

    const categorySuggestions =
      mode === "merge"
        ? []
        : this.validateCategorySuggestions(
            parsed.categorySuggestions,
            categoryPayeeNameById,
            payeeSamplesById,
            ownedCategoryById,
            allowNewCategories,
          );

    const validatedMergeGroups = this.validateMergeGroups(
      parsed.mergeGroups,
      candidateNameById,
    );

    const mergeGroups = await this.filterRejectedMerges(
      userId,
      validatedMergeGroups,
    );

    // Build the unified groups view: confirmed clusters become cluster groups,
    // and every remaining uncategorized payee NOT swallowed by a cluster
    // becomes a singleton group. Each group carries the surviving payee's
    // category suggestion. Capped at `limit` groups.
    const groups = this.buildGroups(
      mergeGroups,
      categorySuggestions,
      categoryPayees,
      limit,
    );

    this.logger.log(
      `Payee organizer suggest user=${userId} mode=${mode} model=${response.model} ` +
        `activePayees=${activePayees.length} categoryPayees=${categoryPayees.length} ` +
        `candidateClusters=${allCandidateClusters.length} analysedClusters=${clustersThisRun.length} ` +
        `remainingClusters=${mergeCandidateClustersRemaining} categories=${categories.length} ` +
        `categorySuggestions=${categorySuggestions.length} ` +
        `mergeGroups=${mergeGroups.length} groups=${groups.length} allowNew=${allowNewCategories}`,
    );

    return {
      categorySuggestions,
      mergeGroups,
      groups,
      model: response.model,
      mergeCandidateClustersRemaining,
    };
  }

  /**
   * Add the uncategorized members of this run's clusters to the category-pass
   * input so the AI can suggest a category for whichever member becomes the
   * canonical survivor. Members already in the base slice keep their samples;
   * newly-added members get samples fetched in one batch. The optional
   * minTransactions filter applies to standalone payees only (it already
   * filtered the base slice); cluster members bypass it because the user is
   * actively reviewing them for a merge.
   */
  private async augmentCategoryPayeesWithClusters(
    userId: string,
    baseCategoryPayees: Array<{
      payeeId: string;
      payeeName: string;
      sampleDescriptions: string[];
    }>,
    clustersThisRun: Array<Array<{ id: string; name: string }>>,
  ): Promise<
    Array<{ payeeId: string; payeeName: string; sampleDescriptions: string[] }>
  > {
    if (clustersThisRun.length === 0) return baseCategoryPayees;

    const present = new Set(baseCategoryPayees.map((p) => p.payeeId));
    const uncategorizedIds =
      await this.payeesService.findActiveUncategorizedIds(userId);

    // Cluster members that are uncategorized and not already in the slice.
    const toAdd: Array<{ id: string; name: string }> = [];
    for (const cluster of clustersThisRun) {
      for (const member of cluster) {
        if (present.has(member.id)) continue;
        if (!uncategorizedIds.has(member.id)) continue;
        if (toAdd.some((m) => m.id === member.id)) continue;
        toAdd.push(member);
      }
    }
    if (toAdd.length === 0) return baseCategoryPayees;

    const samples = await this.payeesService.findSamplesForPayees(
      userId,
      toAdd.map((m) => m.id),
      SAMPLE_DESCRIPTIONS_PER_PAYEE,
    );

    const added = toAdd.map((m) => ({
      payeeId: m.id,
      payeeName: m.name,
      sampleDescriptions: samples.get(m.id) ?? [],
    }));

    return [...baseCategoryPayees, ...added];
  }

  /**
   * Assemble the unified groups list from confirmed merge groups and category
   * suggestions:
   * - Each confirmed cluster becomes a cluster group (canonical + duplicates),
   *   carrying the category suggestion for the canonical (if uncategorized).
   * - Every category-pass payee NOT already claimed by a cluster becomes a
   *   singleton group, carrying its own category suggestion (if any).
   * The list is capped at `limit` groups, clusters first.
   */
  private buildGroups(
    mergeGroups: PayeeMergeGroup[],
    categorySuggestions: PayeeCategorySuggestion[],
    categoryPayees: Array<{
      payeeId: string;
      payeeName: string;
      sampleDescriptions: string[];
    }>,
    limit: number,
  ): PayeeGroup[] {
    const categoryByPayeeId = new Map(
      categorySuggestions.map((s) => [s.payeeId, s]),
    );
    const samplesByPayeeId = new Map(
      categoryPayees.map((p) => [p.payeeId, p.sampleDescriptions]),
    );
    const uncategorizedIds = new Set(categoryPayees.map((p) => p.payeeId));

    const toCategory = (
      s: PayeeCategorySuggestion | undefined,
    ): PayeeGroupCategory | null =>
      s
        ? {
            categoryId: s.categoryId,
            categoryName: s.categoryName,
            isNew: s.isNew,
          }
        : null;

    const groups: PayeeGroup[] = [];
    const claimed = new Set<string>();

    // Cluster groups first.
    for (const g of mergeGroups) {
      const memberIds = [
        g.canonicalPayeeId,
        ...g.duplicates.map((d) => d.payeeId),
      ];
      for (const id of memberIds) claimed.add(id);

      const members: PayeeGroupMember[] = [
        {
          payeeId: g.canonicalPayeeId,
          payeeName: g.canonicalName,
          sampleDescriptions: samplesByPayeeId.get(g.canonicalPayeeId) ?? [],
          hasCategory: !uncategorizedIds.has(g.canonicalPayeeId),
        },
        ...g.duplicates.map((d) => ({
          payeeId: d.payeeId,
          payeeName: d.name,
          sampleDescriptions: samplesByPayeeId.get(d.payeeId) ?? [],
          hasCategory: !uncategorizedIds.has(d.payeeId),
        })),
      ];

      groups.push({
        groupId: g.canonicalPayeeId,
        isCluster: true,
        suggestedCanonicalPayeeId: g.canonicalPayeeId,
        mergeReason: g.reason,
        members,
        category: toCategory(categoryByPayeeId.get(g.canonicalPayeeId)),
      });
    }

    // Singleton groups for uncategorized payees not in any cluster.
    for (const p of categoryPayees) {
      if (claimed.has(p.payeeId)) continue;
      groups.push({
        groupId: p.payeeId,
        isCluster: false,
        suggestedCanonicalPayeeId: p.payeeId,
        mergeReason: null,
        members: [
          {
            payeeId: p.payeeId,
            payeeName: p.payeeName,
            sampleDescriptions: p.sampleDescriptions,
            hasCategory: false,
          },
        ],
        category: toCategory(categoryByPayeeId.get(p.payeeId)),
      });
    }

    return groups.slice(0, limit);
  }

  /**
   * Normalize a payee name for clustering: lowercase, strip diacritics
   * (including Polish-specific letters), drop punctuation, collapse
   * whitespace, and trim. Conservative -- it does not stem or reorder words.
   */
  private normalizeName(name: string): string {
    const lowered = name.toLowerCase();
    // Decompose accents (e.g. e + combining acute) and strip them, then handle
    // Polish letters that do not decompose under NFD.
    const deAccented = lowered
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/ł/g, "l")
      .replace(/ą/g, "a")
      .replace(/ę/g, "e")
      .replace(/ó/g, "o")
      .replace(/ś/g, "s")
      .replace(/[żź]/g, "z")
      .replace(/ć/g, "c")
      .replace(/ń/g, "n");
    return deAccented
      .replace(/[^a-z0-9\s]/g, " ") // punctuation -> space
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Split a normalized name into significant tokens, dropping pure-number
   * tokens (branch/terminal numbers) and known location/noise tokens. These
   * tokens form the merchant identity used for clustering.
   */
  private significantTokens(normalized: string): string[] {
    return normalized
      .split(" ")
      .filter((t) => t.length > 0)
      .filter((t) => !/^[0-9]+$/.test(t))
      .filter((t) => !LOCATION_NOISE_TOKENS.has(t));
  }

  /**
   * Build the cluster key for a payee: the leading 1-2 significant tokens.
   * "lidl" and "lidl warszawa 0123" both key on "lidl"; "lidl sp z o o"
   * keys on "lidl" (sp/z/o noise dropped). Falls back to the full normalized
   * string when no significant tokens remain.
   */
  private clusterKey(name: string): string {
    const normalized = this.normalizeName(name);
    const tokens = this.significantTokens(normalized);
    if (tokens.length === 0) return normalized;
    return tokens.slice(0, 2).join(" ");
  }

  /**
   * Deterministically group active payees into duplicate CANDIDATE clusters
   * by merchant-identity key, drop clusters that fall below 2 members after
   * removing previously-rejected pairs, and return clusters of >= 2 payees.
   * The AI then confirms/splits/drops each cluster.
   */
  private async buildCandidateClusters(
    userId: string,
    payees: Array<{ id: string; name: string }>,
  ): Promise<Array<Array<{ id: string; name: string }>>> {
    if (payees.length < 2) return [];

    const byKey = new Map<string, Array<{ id: string; name: string }>>();
    for (const p of payees) {
      const key = this.clusterKey(p.name);
      if (!key) continue;
      const existing = byKey.get(key) ?? [];
      byKey.set(key, [...existing, { id: p.id, name: p.name }]);
    }

    const rawClusters = [...byKey.values()].filter((c) => c.length >= 2);
    if (rawClusters.length === 0) return [];

    // Load rejected pairs once and prune them at the clustering step. A pair
    // marked "not a duplicate" must never re-enter a candidate cluster.
    const rejections = await this.mergeRejectionRepository.find({
      where: { userId },
    });
    const rejectedKeys = new Set(
      rejections.map((r) => this.pairKey(r.payeeIdLow, r.payeeIdHigh)),
    );

    if (rejectedKeys.size === 0) {
      return rawClusters;
    }

    // Within each cluster, greedily drop members so that no surviving pair is
    // a rejected pair. We remove the member that participates in the most
    // rejected pairs first, repeating until the cluster is rejection-free.
    const result: Array<Array<{ id: string; name: string }>> = [];
    for (const cluster of rawClusters) {
      const pruned = this.pruneRejectedPairs(cluster, rejectedKeys);
      if (pruned.length >= 2) result.push(pruned);
    }
    return result;
  }

  /**
   * Remove members from a cluster until no remaining pair is in
   * `rejectedKeys`. Greedy: repeatedly drop the member with the most rejected
   * edges to surviving members. Conservative -- only removes a member when it
   * is actually part of a rejected pair.
   */
  private pruneRejectedPairs(
    cluster: Array<{ id: string; name: string }>,
    rejectedKeys: Set<string>,
  ): Array<{ id: string; name: string }> {
    let members = [...cluster];
    for (;;) {
      const rejectedDegree = new Map<string, number>();
      let anyRejected = false;
      for (let i = 0; i < members.length; i += 1) {
        for (let j = i + 1; j < members.length; j += 1) {
          const { low, high } = this.normalizePair(
            members[i].id,
            members[j].id,
          );
          if (rejectedKeys.has(this.pairKey(low, high))) {
            anyRejected = true;
            rejectedDegree.set(
              members[i].id,
              (rejectedDegree.get(members[i].id) ?? 0) + 1,
            );
            rejectedDegree.set(
              members[j].id,
              (rejectedDegree.get(members[j].id) ?? 0) + 1,
            );
          }
        }
      }
      if (!anyRejected) return members;

      // Drop the member involved in the most rejected pairs (ties: first id).
      let worstId: string | null = null;
      let worstDegree = -1;
      for (const m of members) {
        const degree = rejectedDegree.get(m.id) ?? 0;
        if (degree > worstDegree) {
          worstDegree = degree;
          worstId = m.id;
        }
      }
      members = members.filter((m) => m.id !== worstId);
      if (members.length < 2) return members;
    }
  }

  async apply(
    userId: string,
    dto: ApplyPayeeOrganizationDto,
  ): Promise<PayeeOrganizationApplyResult> {
    // (a) Create approved new categories, de-duplicating by case-insensitive
    // name, and build a newName -> id map.
    const newNames = new Map<string, string>(); // lowercased -> original name
    for (const assignment of dto.categoryAssignments) {
      const name = assignment.newCategoryName?.trim();
      if (!assignment.categoryId && name) {
        const key = name.toLowerCase();
        // Keep the first-seen casing when the same name appears more than once.
        if (!newNames.has(key)) {
          newNames.set(key, name);
        }
      }
    }

    const newCategoryIdByName = new Map<string, string>(); // lowercased -> id
    let categoriesCreated = 0;
    for (const [key, name] of newNames) {
      const created = await this.categoriesService.create(userId, { name });
      newCategoryIdByName.set(key, created.id);
      categoriesCreated += 1;
    }

    // (b) Resolve each assignment to a concrete categoryId, then bulk apply.
    const resolvedAssignments: Array<{ payeeId: string; categoryId: string }> =
      [];
    for (const assignment of dto.categoryAssignments) {
      let categoryId: string | undefined = assignment.categoryId;
      if (!categoryId && assignment.newCategoryName) {
        categoryId = newCategoryIdByName.get(
          assignment.newCategoryName.trim().toLowerCase(),
        );
      }
      if (categoryId) {
        resolvedAssignments.push({ payeeId: assignment.payeeId, categoryId });
      }
    }

    let payeesCategorized = 0;
    if (resolvedAssignments.length > 0) {
      // PayeesService validates category ownership and payee ownership.
      const { updated } = await this.payeesService.applyCategorySuggestions(
        userId,
        resolvedAssignments,
      );
      payeesCategorized = updated;
    }

    // (c) Merge each source into its target. mergePayees validates ownership
    // of both payees and is atomic per call.
    let payeesMerged = 0;
    for (const merge of dto.merges) {
      const uniqueSources = [...new Set(merge.sourcePayeeIds)];
      for (const sourcePayeeId of uniqueSources) {
        if (sourcePayeeId === merge.targetPayeeId) continue;
        await this.payeesService.mergePayees(userId, {
          targetPayeeId: merge.targetPayeeId,
          sourcePayeeId,
          addAsAlias: true,
        });
        payeesMerged += 1;
      }
    }

    // (d) Persist "not a duplicate" decisions so suggest() never re-proposes
    // them. Validates payee ownership defensively before inserting.
    const mergeRejectionsSaved = await this.persistMergeRejections(
      userId,
      dto.rejectedMerges ?? [],
    );

    this.logger.log(
      `Payee organizer apply user=${userId} categoriesCreated=${categoriesCreated} ` +
        `payeesCategorized=${payeesCategorized} payeesMerged=${payeesMerged} ` +
        `mergeRejectionsSaved=${mergeRejectionsSaved}`,
    );

    return {
      categoriesCreated,
      payeesCategorized,
      payeesMerged,
      mergeRejectionsSaved,
    };
  }

  /**
   * Insert a normalized rejection row for each (canonical, duplicate) pair,
   * ignoring duplicates that already exist. Returns how many new rows were
   * actually written. Both payee ids must belong to the user; pairs that
   * reference an unowned payee are skipped.
   */
  private async persistMergeRejections(
    userId: string,
    rejectedMerges: Array<{
      canonicalPayeeId: string;
      duplicatePayeeIds: string[];
    }>,
  ): Promise<number> {
    if (rejectedMerges.length === 0) return 0;

    // Collect the candidate normalized pairs, de-duplicated locally.
    const pairByKey = new Map<string, { low: string; high: string }>();
    for (const merge of rejectedMerges) {
      for (const duplicateId of merge.duplicatePayeeIds) {
        if (duplicateId === merge.canonicalPayeeId) continue;
        const { low, high } = this.normalizePair(
          merge.canonicalPayeeId,
          duplicateId,
        );
        pairByKey.set(this.pairKey(low, high), { low, high });
      }
    }
    if (pairByKey.size === 0) return 0;

    // Defensively confirm every referenced payee belongs to the user, so a
    // forged id cannot create a rejection (or leak that an id exists via FK).
    const allIds = new Set<string>();
    for (const { low, high } of pairByKey.values()) {
      allIds.add(low);
      allIds.add(high);
    }
    const ownedIds = await this.payeesService.findOwnedIds(userId, [...allIds]);

    const rows = [...pairByKey.values()]
      .filter((p) => ownedIds.has(p.low) && ownedIds.has(p.high))
      .map((p) => ({
        userId,
        payeeIdLow: p.low,
        payeeIdHigh: p.high,
      }));
    if (rows.length === 0) return 0;

    const result = await this.mergeRejectionRepository
      .createQueryBuilder()
      .insert()
      .into(PayeeMergeRejection)
      .values(rows)
      .orIgnore()
      .execute();

    // identifiers contains one entry per row actually inserted (empty for
    // rows skipped by ON CONFLICT DO NOTHING).
    return result.identifiers.filter((id) => id != null).length;
  }

  private buildPrompt(
    payees: Array<{
      payeeId: string;
      payeeName: string;
      sampleDescriptions: string[];
    }>,
    categories: Array<{
      id: string;
      name: string;
      parentName: string | null;
      isIncome: boolean;
    }>,
    allowNewCategories: boolean,
    mode: "all" | "merge" = "all",
    candidateClusters: Array<Array<{ id: string; name: string }>> = [],
  ): string {
    const sections: string[] = [];

    if (mode === "merge") {
      // Duplicate-detection only: no categories, no category suggestions.
      sections.push(
        'MODE: MERGE ONLY. Do NOT categorize. Return an empty "categorySuggestions" array and only populate "mergeGroups".',
      );
    } else {
      sections.push(
        `New categories allowed: ${allowNewCategories ? "YES" : "NO"}`,
      );

      sections.push("\n--- EXISTING CATEGORIES ---");
      if (categories.length === 0) {
        sections.push("(none)");
      } else {
        for (const c of categories) {
          const label = c.parentName
            ? `${sanitizePromptValue(c.parentName)}: ${sanitizePromptValue(c.name)}`
            : sanitizePromptValue(c.name);
          sections.push(
            `categoryId=${c.id} | name="${label}" | type=${c.isIncome ? "income" : "expense"}`,
          );
        }
      }

      sections.push("\n--- UNCATEGORIZED PAYEES ---");
      for (const p of payees) {
        const samples =
          p.sampleDescriptions.length > 0
            ? ` | samples=[${p.sampleDescriptions
                .map((d) => `"${sanitizePromptValue(d)}"`)
                .join(", ")}]`
            : "";
        sections.push(
          `payeeId=${p.payeeId} | name="${sanitizePromptValue(p.payeeName)}"${samples}`,
        );
      }
    }

    // Candidate duplicate clusters: pre-grouped by name similarity. The AI
    // CONFIRMS which members are truly the same merchant rather than scanning
    // the whole payee list itself.
    sections.push("\n--- DUPLICATE CANDIDATE GROUPS ---");
    sections.push(
      "Here are groups of payees with similar names. For each group, confirm which members are truly the SAME real-world merchant, pick the cleanest canonical name, and give a short reason. SPLIT a group if some members are different merchants (e.g. 'Shell' fuel vs 'Shell Energy'). DROP a group entirely if none are duplicates. Use ONLY the payeeIds listed below; never invent ids and never reference payees outside these groups.",
    );
    if (candidateClusters.length === 0) {
      sections.push("(none)");
    } else {
      candidateClusters.forEach((cluster, index) => {
        const members = cluster
          .map(
            (m) => `{payeeId=${m.id}, name="${sanitizePromptValue(m.name)}"}`,
          )
          .join(", ");
        sections.push(`group ${index + 1}: [${members}]`);
      });
    }

    return sections.join("\n");
  }

  private parseResponse(
    content: string,
    userId: string,
  ): {
    categorySuggestions: unknown[];
    mergeGroups: unknown[];
  } {
    const trimmed = content.trim();
    const stripped = this.stripMarkdownFences(trimmed);

    let parsed: unknown = this.safeJsonParse(stripped);
    if (parsed === undefined) {
      // Tolerate preamble/trailing text by extracting the first object blob.
      const objectMatch = stripped.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        parsed = this.safeJsonParse(objectMatch[0]);
      }
    }

    if (!parsed || typeof parsed !== "object") {
      this.logger.warn(
        `Payee organizer response was not a JSON object user=${userId} ` +
          `preview="${trimmed.slice(0, 300).replace(/\s+/g, " ")}"`,
      );
      return { categorySuggestions: [], mergeGroups: [] };
    }

    if (JSON.stringify(parsed).length > MAX_JSON_SIZE) {
      this.logger.warn(
        `Payee organizer response too large user=${userId} limit=${MAX_JSON_SIZE}`,
      );
      return { categorySuggestions: [], mergeGroups: [] };
    }

    const obj = parsed as Record<string, unknown>;
    return {
      categorySuggestions: Array.isArray(obj.categorySuggestions)
        ? obj.categorySuggestions
        : [],
      mergeGroups: Array.isArray(obj.mergeGroups) ? obj.mergeGroups : [],
    };
  }

  private validateCategorySuggestions(
    raw: unknown[],
    payeeNameById: Map<string, string>,
    payeeSamplesById: Map<string, string[]>,
    ownedCategoryById: Map<string, string>,
    allowNewCategories: boolean,
  ): PayeeCategorySuggestion[] {
    const result: PayeeCategorySuggestion[] = [];
    const seenPayees = new Set<string>();

    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;

      const payeeId = typeof obj.payeeId === "string" ? obj.payeeId : null;
      if (!payeeId || !payeeNameById.has(payeeId)) continue;
      // One suggestion per payee; keep the first valid one.
      if (seenPayees.has(payeeId)) continue;

      const isNew = obj.isNew === true;

      if (isNew) {
        // Drop new-category proposals when the toggle forbids them.
        if (!allowNewCategories) continue;
        const categoryName =
          typeof obj.categoryName === "string" ? obj.categoryName.trim() : "";
        if (!categoryName) continue;
        seenPayees.add(payeeId);
        result.push({
          payeeId,
          payeeName: payeeNameById.get(payeeId)!,
          categoryId: null,
          categoryName: categoryName.substring(0, 100),
          isNew: true,
          sampleDescriptions: payeeSamplesById.get(payeeId) ?? [],
        });
      } else {
        const categoryId =
          typeof obj.categoryId === "string" ? obj.categoryId : null;
        // Drop hallucinated category ids the user does not own.
        if (!categoryId || !ownedCategoryById.has(categoryId)) continue;
        seenPayees.add(payeeId);
        result.push({
          payeeId,
          payeeName: payeeNameById.get(payeeId)!,
          categoryId,
          categoryName: ownedCategoryById.get(categoryId)!,
          isNew: false,
          sampleDescriptions: payeeSamplesById.get(payeeId) ?? [],
        });
      }
    }

    return result;
  }

  private validateMergeGroups(
    raw: unknown[],
    payeeNameById: Map<string, string>,
  ): PayeeMergeGroup[] {
    const result: PayeeMergeGroup[] = [];
    // A payee may only belong to one merge group across the whole result.
    const claimed = new Set<string>();

    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;

      const canonicalPayeeId =
        typeof obj.canonicalPayeeId === "string" ? obj.canonicalPayeeId : null;
      if (
        !canonicalPayeeId ||
        !payeeNameById.has(canonicalPayeeId) ||
        claimed.has(canonicalPayeeId)
      ) {
        continue;
      }

      const rawDuplicates = Array.isArray(obj.duplicates) ? obj.duplicates : [];
      const duplicates: Array<{ payeeId: string; name: string }> = [];
      for (const dup of rawDuplicates) {
        if (!dup || typeof dup !== "object") continue;
        const dupObj = dup as Record<string, unknown>;
        const dupId =
          typeof dupObj.payeeId === "string" ? dupObj.payeeId : null;
        if (!dupId || !payeeNameById.has(dupId)) continue;
        if (dupId === canonicalPayeeId) continue;
        if (claimed.has(dupId)) continue;
        if (duplicates.some((d) => d.payeeId === dupId)) continue;
        duplicates.push({ payeeId: dupId, name: payeeNameById.get(dupId)! });
      }

      // A group needs at least one real duplicate to be actionable.
      if (duplicates.length === 0) continue;

      claimed.add(canonicalPayeeId);
      for (const d of duplicates) claimed.add(d.payeeId);

      result.push({
        canonicalPayeeId,
        canonicalName: payeeNameById.get(canonicalPayeeId)!,
        duplicates,
        reason:
          typeof obj.reason === "string"
            ? obj.reason.substring(0, 500)
            : "Likely duplicate payees",
      });
    }

    return result;
  }

  /**
   * Drop any duplicate the user previously marked NOT a duplicate of the
   * group's canonical payee. Pairs are matched on their normalized form so the
   * order they were rejected in does not matter. A group left with zero
   * surviving duplicates is dropped entirely.
   */
  private async filterRejectedMerges(
    userId: string,
    groups: PayeeMergeGroup[],
  ): Promise<PayeeMergeGroup[]> {
    if (groups.length === 0) return groups;

    const rejections = await this.mergeRejectionRepository.find({
      where: { userId },
    });
    if (rejections.length === 0) return groups;

    const rejectedKeys = new Set(
      rejections.map((r) => this.pairKey(r.payeeIdLow, r.payeeIdHigh)),
    );

    const result: PayeeMergeGroup[] = [];
    for (const group of groups) {
      const duplicates = group.duplicates.filter((d) => {
        const { low, high } = this.normalizePair(
          group.canonicalPayeeId,
          d.payeeId,
        );
        return !rejectedKeys.has(this.pairKey(low, high));
      });
      if (duplicates.length === 0) continue;
      result.push({ ...group, duplicates });
    }
    return result;
  }

  private stripMarkdownFences(text: string): string {
    const fenceMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i);
    if (fenceMatch) {
      return fenceMatch[1].trim();
    }
    return text;
  }

  private safeJsonParse(text: string): unknown | undefined {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }
}
