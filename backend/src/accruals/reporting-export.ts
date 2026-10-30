import { escapeCsvCell } from "../common/csv-cell.util";
import type { ReportResult } from "../reports/dto/execute-report.dto";
/** Portable report artifact. Metadata is repeated per CSV row, including empties. */
export function exportReport(report: ReportResult) {
  const columns = [
    "basis",
    "currency",
    "fxComplete",
    "label",
    "value",
    "sourceTransactionId",
    "sourceSplitId",
    "reportId",
    "cashDate",
    "effectiveDate",
    "nativeAmount",
    "sourceAmount",
    ...(report.truncated ? ["dataComplete", "truncated", "rowLimit"] : []),
  ];
  const rows = report.data.length
    ? report.data
    : [{ label: "", value: null, reportingProvenance: undefined }];
  const csv = [
    columns.join(","),
    ...rows.map((row) =>
      [
        report.basis,
        report.currency,
        report.fxComplete,
        row.label,
        row.value,
        row.reportingProvenance?.sourceTransactionId,
        row.reportingProvenance?.sourceSplitId,
        row.reportingProvenance?.reportId,
        row.reportingProvenance?.cashDate,
        row.reportingProvenance?.effectiveDate,
        row.reportingProvenance?.nativeAmount,
        row.reportingProvenance?.sourceAmount,
        ...(report.truncated
          ? [report.dataComplete, report.truncated, report.rowLimit]
          : []),
      ]
        .map((value) =>
          escapeCsvCell(
            value === null || value === undefined ? "" : String(value),
          ),
        )
        .join(","),
    ),
  ].join("\r\n");
  return {
    format: "monize-report-v1",
    ...(report.truncated
      ? {
          dataComplete: false as const,
          truncated: true as const,
          rowLimit: report.rowLimit,
        }
      : {}),
    basis: report.basis,
    currency: report.currency,
    fxComplete: report.fxComplete,
    report,
    csv,
  };
}
