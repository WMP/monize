import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  ManyToMany,
  JoinTable,
  JoinColumn,
  Unique,
} from "typeorm";
import { ApiProperty } from "@nestjs/swagger";
import { User } from "../../users/entities/user.entity";
import { Tag } from "../../tags/entities/tag.entity";

@Entity("securities")
@Unique(["userId", "symbol"])
export class Security {
  @ApiProperty({ example: "c5f5d5f0-1234-4567-890a-123456789abc" })
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ApiProperty({ description: "Owner user ID" })
  @Column({ type: "uuid", name: "user_id" })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: "user_id" })
  user: User;

  @ApiProperty({ example: "AAPL", description: "Stock symbol or ticker" })
  @Column({ type: "varchar", length: 20 })
  symbol: string;

  @ApiProperty({
    example: "Apple Inc.",
    description: "Full name of the security",
  })
  @Column({ type: "varchar", length: 255 })
  name: string;

  @ApiProperty({ example: "STOCK", description: "Type of security" })
  @Column({
    type: "varchar",
    length: 50,
    name: "security_type",
    nullable: true,
  })
  securityType: string | null;

  @ApiProperty({ example: "NASDAQ", description: "Stock exchange" })
  @Column({ type: "varchar", length: 50, nullable: true })
  exchange: string | null;

  @ApiProperty({ example: "USD" })
  @Column({ type: "varchar", length: 3, name: "currency_code" })
  currencyCode: string;

  @ApiProperty({
    example: "Global aggregate bond ETF. ~99% bonds, ~1% cash. TER 0.10%.",
    description:
      "Free-text description, optionally pre-filled from the quote provider",
    nullable: true,
  })
  @Column({ type: "text", nullable: true })
  description: string | null;

  @ApiProperty({ example: true })
  @Column({ type: "boolean", default: true, name: "is_active" })
  isActive: boolean;

  @ApiProperty({
    example: false,
    description: "Pinned to the dashboard Favourite Securities widget",
  })
  @Column({ type: "boolean", default: false, name: "is_favourite" })
  isFavourite: boolean;

  @ApiProperty({
    example: false,
    description: "Skip price updates for auto-generated symbols",
  })
  @Column({ type: "boolean", default: false, name: "skip_price_updates" })
  skipPriceUpdates: boolean;

  @ApiProperty({
    example: "active",
    description:
      "Whether we ask the quote provider for this security's prices. " +
      "'active' = fetch normally; 'auto_disabled' = the system stopped after a " +
      "run of provider 'no such symbol' (404/422) answers, and re-probes " +
      "occasionally; 'disabled' = the user turned fetching off.",
    enum: ["active", "auto_disabled", "disabled"],
  })
  @Column({
    type: "varchar",
    length: 20,
    name: "price_fetch_status",
    default: "active",
  })
  priceFetchStatus: "active" | "auto_disabled" | "disabled";

  @ApiProperty({
    example: 0,
    description:
      "Consecutive provider 'no such symbol' (404/422) answers; reset to 0 on " +
      "any successful price. Drives the auto-disable threshold.",
  })
  @Column({
    type: "int",
    name: "price_fetch_failure_count",
    default: 0,
  })
  priceFetchFailureCount: number;

  @ApiProperty({
    required: false,
    nullable: true,
    description:
      "Instant of the most recent 404-type answer; drives the re-probe cooldown.",
  })
  @Column({
    type: "timestamp",
    nullable: true,
    name: "price_fetch_last_failure_at",
  })
  priceFetchLastFailureAt: Date | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description:
      "When the system auto-disabled fetching (null unless auto_disabled).",
  })
  @Column({
    type: "timestamp",
    nullable: true,
    name: "price_fetch_auto_disabled_at",
  })
  priceFetchAutoDisabledAt: Date | null;

  @ApiProperty({
    example: "Technology",
    description: "Stock sector from Yahoo Finance",
  })
  @Column({ type: "varchar", length: 100, nullable: true })
  sector: string | null;

  @ApiProperty({
    example: "Consumer Electronics",
    description: "Stock industry from Yahoo Finance",
  })
  @Column({ type: "varchar", length: 100, nullable: true })
  industry: string | null;

  @ApiProperty({ description: "ETF sector breakdown array [{sector, weight}]" })
  @Column({ type: "jsonb", nullable: true, name: "sector_weightings" })
  sectorWeightings: { sector: string; weight: number }[] | null;

  @ApiProperty({
    description:
      "Manual ETF/fund country breakdown array [{name, weight}]. weight is a " +
      "decimal 0-1 (same convention as sectorWeightings). A shortfall under 1.0 " +
      "is shown as 'Other' at display/report time and is not stored.",
  })
  @Column({ type: "jsonb", nullable: true, name: "country_weightings" })
  countryWeightings: { name: string; weight: number }[] | null;

  @ApiProperty({
    description:
      "Manual ETF/fund asset-class breakdown array [{name, weight}]. Names are " +
      "free text (the picker offers the ones the user has already used); weight " +
      "is a decimal 0-1. A shortfall under 1.0 is shown as 'Other' at display " +
      "time and is not stored.",
  })
  @Column({ type: "jsonb", nullable: true, name: "asset_weightings" })
  assetWeightings: { name: string; weight: number }[] | null;

  @ApiProperty({ description: "When sector data was last fetched from Yahoo" })
  @Column({ type: "timestamp", nullable: true, name: "sector_data_updated_at" })
  sectorDataUpdatedAt: Date | null;

  @ApiProperty({
    example: "https://www.apple.com",
    description:
      "The issuer's or product's own page. Auto-filled from Yahoo's summaryProfile where the provider has one, which in practice means shares; for ETFs and funds it stays empty unless the user types it.",
    nullable: true,
  })
  @Column({ type: "varchar", length: 2048, nullable: true })
  website: string | null;

  @ApiProperty({
    example: "https://investor.apple.com",
    description:
      "The investor-relations page. Manual by nature: no quote provider publishes one, and deriving it from the domain would produce a link that mostly 404s.",
    nullable: true,
  })
  @Column({ type: "varchar", length: 2048, name: "ir_website", nullable: true })
  irWebsite: string | null;

  @ApiProperty({
    example: "yahoo",
    description:
      "Per-security quote provider override ('yahoo' | 'msn'); NULL = use user default",
    nullable: true,
  })
  @Column({
    type: "varchar",
    length: 20,
    nullable: true,
    name: "quote_provider",
  })
  quoteProvider: "yahoo" | "msn" | null;

  @ApiProperty({
    example: "a1u3p2",
    description:
      "Cached MSN Financial Instrument ID (SecId); auto-resolved from ticker on first MSN call",
    nullable: true,
  })
  @Column({
    type: "varchar",
    length: 50,
    nullable: true,
    name: "msn_instrument_id",
  })
  msnInstrumentId: string | null;

  /**
   * Last time we asked the quote provider for a multi-year historical
   * backfill. Lets the Monte Carlo "Use historical returns" path skip
   * provider calls when we've already pulled what's available — so
   * selecting the same accounts repeatedly doesn't keep hitting the API.
   */
  @ApiProperty({ required: false })
  @Column({
    type: "timestamp",
    nullable: true,
    name: "historical_backfill_attempted_at",
  })
  historicalBackfillAttemptedAt: Date | null;

  /**
   * Where and when this instrument trades, as reported by the provider rather
   * than guessed from the exchange code -- a code can be an alias, a provider's
   * display name, or free text from an import, and a wrong guess would claim a
   * market is open when it is not. The session times are local to
   * `marketTimezone`. All three are null until a refresh reports them.
   */
  @ApiProperty({ required: false, nullable: true })
  @Column({
    type: "varchar",
    length: 64,
    nullable: true,
    name: "market_timezone",
  })
  marketTimezone: string | null;

  @ApiProperty({ required: false, nullable: true })
  @Column({ type: "time", nullable: true, name: "market_open_time" })
  marketOpenTime: string | null;

  @ApiProperty({ required: false, nullable: true })
  @Column({ type: "time", nullable: true, name: "market_close_time" })
  marketCloseTime: string | null;

  @ApiProperty({ description: "User-defined tags classifying this security" })
  @ManyToMany(() => Tag)
  @JoinTable({
    name: "security_tags",
    joinColumn: { name: "security_id", referencedColumnName: "id" },
    inverseJoinColumn: { name: "tag_id", referencedColumnName: "id" },
  })
  tags: Tag[];

  @ApiProperty()
  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
