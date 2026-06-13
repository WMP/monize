import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { tr } from "../../i18n/translate";
import {
  AiSuggestionSession,
  PayeeCategorizationSuggestionItem,
  SuggestionSessionKind,
  SuggestionSessionStatus,
} from "./entities/ai-suggestion-session.entity";
import { PayeesService } from "../../payees/payees.service";
import { CategoriesService } from "../../categories/categories.service";
import { Category } from "../../categories/entities/category.entity";

/** Raw LLM-produced suggestion as it arrives from the write tool. */
export interface IncomingPayeeCategorySuggestion {
  payeeId: string;
  categoryId?: string | null;
  newCategoryName?: string | null;
  reason?: string | null;
  confidence?: number | null;
}

export interface SavePayeeCategorySuggestionsInput {
  sessionId?: string;
  title?: string;
  suggestions: IncomingPayeeCategorySuggestion[];
}

export interface SessionListEntry {
  id: string;
  kind: SuggestionSessionKind;
  status: SuggestionSessionStatus;
  title: string | null;
  itemCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApplySessionItem {
  payeeId: string;
  categoryId?: string;
  newCategoryName?: string;
}

const PAYEE_CATEGORIZATION: SuggestionSessionKind = "payee_categorization";
const MAX_SUGGESTIONS = 500;

@Injectable()
export class AiSuggestionSessionService {
  constructor(
    @InjectRepository(AiSuggestionSession)
    private readonly sessionsRepository: Repository<AiSuggestionSession>,
    private readonly dataSource: DataSource,
    private readonly payeesService: PayeesService,
    private readonly categoriesService: CategoriesService,
  ) {}

  /**
   * Persist an LLM-produced set of payee-category suggestions as a DRAFT.
   * Creates a new draft, or replaces the items of an existing owned draft when
   * `sessionId` is supplied. Never applies anything -- applying is a separate,
   * human-initiated action.
   */
  async savePayeeCategorySuggestions(
    userId: string,
    input: SavePayeeCategorySuggestionsInput,
  ): Promise<{ sessionId: string; savedCount: number }> {
    const suggestions = input.suggestions ?? [];
    if (suggestions.length === 0) {
      throw new BadRequestException(
        tr(
          "errors.aiSessions.noSuggestions",
          "At least one suggestion is required",
        ),
      );
    }
    if (suggestions.length > MAX_SUGGESTIONS) {
      throw new BadRequestException(
        tr(
          "errors.aiSessions.tooManySuggestions",
          `At most ${MAX_SUGGESTIONS} suggestions are allowed per session`,
          { max: MAX_SUGGESTIONS },
        ),
      );
    }

    // Each suggestion must pick exactly one of an existing category or a new
    // category name. Reject ambiguous or empty assignments early.
    for (const s of suggestions) {
      const hasCategory = !!s.categoryId;
      const hasNewName = !!(s.newCategoryName && s.newCategoryName.trim());
      if (hasCategory === hasNewName) {
        throw new BadRequestException(
          tr(
            "errors.aiSessions.exactlyOneCategory",
            "Each suggestion must specify exactly one of categoryId or newCategoryName",
          ),
        );
      }
    }

    // Ownership: every payee must belong to the user.
    const payeeIds = suggestions.map((s) => s.payeeId);
    const ownedPayees = await this.payeesService.findOwnedIds(userId, payeeIds);
    const unknownPayees = [...new Set(payeeIds)].filter(
      (id) => !ownedPayees.has(id),
    );
    if (unknownPayees.length > 0) {
      throw new BadRequestException(
        tr(
          "errors.aiSessions.payeesNotOwned",
          `Payee IDs not found or not owned by user: ${unknownPayees.join(", ")}`,
          { ids: unknownPayees.join(", ") },
        ),
      );
    }

    // Ownership: every referenced existing category must belong to the user.
    const categoryIds = suggestions
      .map((s) => s.categoryId)
      .filter((id): id is string => !!id);
    if (categoryIds.length > 0) {
      const ownedCategories = await this.payeesCategoryOwnership(
        userId,
        categoryIds,
      );
      const unknownCategories = [...new Set(categoryIds)].filter(
        (id) => !ownedCategories.has(id),
      );
      if (unknownCategories.length > 0) {
        throw new BadRequestException(
          tr(
            "errors.aiSessions.categoriesNotOwned",
            `Category IDs not found or not owned by user: ${unknownCategories.join(", ")}`,
            { ids: unknownCategories.join(", ") },
          ),
        );
      }
    }

    const items: PayeeCategorizationSuggestionItem[] = suggestions.map((s) => ({
      payeeId: s.payeeId,
      suggestedCategoryId: s.categoryId ?? null,
      newCategoryName: s.newCategoryName?.trim() || null,
      reason: s.reason?.trim() || null,
      confidence: typeof s.confidence === "number" ? s.confidence : null,
    }));

    if (input.sessionId) {
      const existing = await this.sessionsRepository.findOne({
        where: { id: input.sessionId, userId },
      });
      if (!existing) {
        throw new NotFoundException(
          tr(
            "errors.aiSessions.notFound",
            `Suggestion session with ID ${input.sessionId} not found`,
            { id: input.sessionId },
          ),
        );
      }
      existing.items = items;
      if (input.title !== undefined) existing.title = input.title.trim() || null;
      // Re-opening a previously applied/discarded session as a fresh draft is
      // intentional: the write tool always produces a draft.
      existing.status = "draft";
      const saved = await this.sessionsRepository.save(existing);
      return { sessionId: saved.id, savedCount: items.length };
    }

    const created = this.sessionsRepository.create({
      userId,
      kind: PAYEE_CATEGORIZATION,
      status: "draft",
      title: input.title?.trim() || null,
      items,
    });
    const saved = await this.sessionsRepository.save(created);
    return { sessionId: saved.id, savedCount: items.length };
  }

  async listSessions(
    userId: string,
    filters: {
      kind?: SuggestionSessionKind;
      status?: SuggestionSessionStatus;
    } = {},
  ): Promise<SessionListEntry[]> {
    const where: Record<string, unknown> = { userId };
    if (filters.kind) where.kind = filters.kind;
    if (filters.status) where.status = filters.status;

    const sessions = await this.sessionsRepository.find({
      where,
      order: { updatedAt: "DESC" },
    });

    return sessions.map((s) => ({
      id: s.id,
      kind: s.kind,
      status: s.status,
      title: s.title,
      itemCount: Array.isArray(s.items) ? s.items.length : 0,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  }

  /**
   * Return a session enriched for human review: current payee names, resolved
   * suggested category names (or the proposed new name), and a few recent
   * transaction descriptions per payee. Display fields are resolved fresh here,
   * never read from storage.
   */
  async getSession(userId: string, id: string) {
    const session = await this.sessionsRepository.findOne({
      where: { id, userId },
    });
    if (!session) {
      throw new NotFoundException(
        tr(
          "errors.aiSessions.notFound",
          `Suggestion session with ID ${id} not found`,
          { id },
        ),
      );
    }

    const items = Array.isArray(session.items) ? session.items : [];
    const payeeIds = items.map((i) => i.payeeId);

    const [payeeNames, descriptions, categories] = await Promise.all([
      this.payeesService.getNamesByIds(userId, payeeIds),
      this.payeesService.getRecentDescriptionsByPayee(userId, payeeIds, 8),
      this.categoriesService.findAll(userId, false),
    ]);
    const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

    const enrichedItems = items.map((item) => ({
      payeeId: item.payeeId,
      payeeName: payeeNames.get(item.payeeId) ?? null,
      suggestedCategoryId: item.suggestedCategoryId,
      newCategoryName: item.newCategoryName,
      suggestedCategoryName: item.suggestedCategoryId
        ? (categoryNameById.get(item.suggestedCategoryId) ?? null)
        : (item.newCategoryName ?? null),
      reason: item.reason,
      confidence: item.confidence,
      sampleDescriptions: descriptions.get(item.payeeId) ?? [],
    }));

    return {
      id: session.id,
      kind: session.kind,
      status: session.status,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      items: enrichedItems,
    };
  }

  /**
   * Apply the chosen items from a draft session: create any new categories
   * (deduped by name), set each payee's default category, and mark the session
   * applied. Only the items the user passes are applied. Runs in a single
   * transaction so a partial failure leaves nothing applied.
   */
  async applySession(
    userId: string,
    id: string,
    payload: { items: ApplySessionItem[] },
  ): Promise<{ categoriesCreated: number; payeesCategorized: number }> {
    const session = await this.sessionsRepository.findOne({
      where: { id, userId },
    });
    if (!session) {
      throw new NotFoundException(
        tr(
          "errors.aiSessions.notFound",
          `Suggestion session with ID ${id} not found`,
          { id },
        ),
      );
    }

    const items = payload.items ?? [];
    if (items.length === 0) {
      throw new BadRequestException(
        tr("errors.aiSessions.noItemsToApply", "No items to apply"),
      );
    }

    for (const item of items) {
      const hasCategory = !!item.categoryId;
      const hasNewName = !!(item.newCategoryName && item.newCategoryName.trim());
      if (hasCategory === hasNewName) {
        throw new BadRequestException(
          tr(
            "errors.aiSessions.exactlyOneCategory",
            "Each suggestion must specify exactly one of categoryId or newCategoryName",
          ),
        );
      }
    }

    // Ownership of payees and any existing categories the caller references.
    const payeeIds = items.map((i) => i.payeeId);
    const ownedPayees = await this.payeesService.findOwnedIds(userId, payeeIds);
    const unknownPayees = [...new Set(payeeIds)].filter(
      (pid) => !ownedPayees.has(pid),
    );
    if (unknownPayees.length > 0) {
      throw new BadRequestException(
        tr(
          "errors.aiSessions.payeesNotOwned",
          `Payee IDs not found or not owned by user: ${unknownPayees.join(", ")}`,
          { ids: unknownPayees.join(", ") },
        ),
      );
    }

    const existingCategoryIds = items
      .map((i) => i.categoryId)
      .filter((cid): cid is string => !!cid);
    if (existingCategoryIds.length > 0) {
      const owned = await this.payeesCategoryOwnership(
        userId,
        existingCategoryIds,
      );
      const unknown = [...new Set(existingCategoryIds)].filter(
        (cid) => !owned.has(cid),
      );
      if (unknown.length > 0) {
        throw new BadRequestException(
          tr(
            "errors.aiSessions.categoriesNotOwned",
            `Category IDs not found or not owned by user: ${unknown.join(", ")}`,
            { ids: unknown.join(", ") },
          ),
        );
      }
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      // Dedupe new category names case-insensitively, and reuse any existing
      // category with the same name rather than creating a duplicate.
      const existingByLowerName = new Map<string, string>();
      const allCategories = await queryRunner.manager.find(Category, {
        where: { userId },
        select: ["id", "name"],
      });
      for (const c of allCategories) {
        existingByLowerName.set(c.name.toLowerCase(), c.id);
      }

      let categoriesCreated = 0;
      const newNameToId = new Map<string, string>();

      // Resolve each item to a final categoryId, creating categories as needed.
      const assignments: Array<{ payeeId: string; categoryId: string }> = [];
      for (const item of items) {
        let categoryId = item.categoryId;
        if (!categoryId) {
          const name = item.newCategoryName!.trim();
          const lower = name.toLowerCase();
          categoryId =
            newNameToId.get(lower) ?? existingByLowerName.get(lower);
          if (!categoryId) {
            const category = queryRunner.manager.create(Category, {
              name,
              userId,
              isIncome: false,
            });
            const savedCategory = await queryRunner.manager.save(category);
            categoryId = savedCategory.id;
            categoriesCreated += 1;
            newNameToId.set(lower, categoryId);
            existingByLowerName.set(lower, categoryId);
          }
        }
        assignments.push({ payeeId: item.payeeId, categoryId });
      }

      // Set the default category on each payee within the same transaction.
      let payeesCategorized = 0;
      const seenPayees = new Set<string>();
      for (const a of assignments) {
        const res = await queryRunner.manager.update(
          "payees",
          { id: a.payeeId, userId },
          { defaultCategoryId: a.categoryId },
        );
        if ((res.affected ?? 0) > 0 && !seenPayees.has(a.payeeId)) {
          seenPayees.add(a.payeeId);
          payeesCategorized += 1;
        }
      }

      session.status = "applied";
      await queryRunner.manager.save(session);

      await queryRunner.commitTransaction();
      return { categoriesCreated, payeesCategorized };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async discardSession(userId: string, id: string): Promise<void> {
    const session = await this.sessionsRepository.findOne({
      where: { id, userId },
    });
    if (!session) {
      throw new NotFoundException(
        tr(
          "errors.aiSessions.notFound",
          `Suggestion session with ID ${id} not found`,
          { id },
        ),
      );
    }
    session.status = "discarded";
    await this.sessionsRepository.save(session);
  }

  /**
   * Resolve which of the given category IDs belong to the user. Sourced via the
   * categories service so the catalog matches the rest of the app.
   */
  private async payeesCategoryOwnership(
    userId: string,
    categoryIds: string[],
  ): Promise<Set<string>> {
    const unique = new Set(categoryIds);
    if (unique.size === 0) return new Set();
    const categories = await this.categoriesService.findAll(userId, true);
    const owned = new Set<string>();
    for (const c of categories) {
      if (unique.has(c.id)) owned.add(c.id);
    }
    return owned;
  }
}
