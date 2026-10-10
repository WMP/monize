import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Unique,
} from "typeorm";

/**
 * One sovereign bond series, for any issuer country (the Polish retail bonds
 * are the first instruments, not the shape of the table).
 *
 * Global reference data: no `userId` and no RLS policy -- one instrument serves
 * every account, as an exchange rate does. Insert only. See
 * `docs/specs/polish-retail-bonds.md` and the exemption note at the foot of
 * `database/schema.sql`.
 */
@Entity("bond_instruments")
@Unique(["issuerCountryCode", "issuerCode", "seriesCode"])
export class BondInstrument {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "char", length: 2, name: "issuer_country_code" })
  issuerCountryCode: string;

  @Column({ type: "varchar", length: 40, name: "issuer_code" })
  issuerCode: string;

  @Column({ type: "varchar", length: 40, name: "program_code" })
  programCode: string;

  @Column({ type: "varchar", length: 40, name: "series_code" })
  seriesCode: string;

  @Column({ type: "varchar", length: 3, name: "currency_code" })
  currencyCode: string;

  @Column({ type: "varchar", length: 30 })
  marketability: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
