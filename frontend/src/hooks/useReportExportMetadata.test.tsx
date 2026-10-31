import { usePreferencesStore } from "@/store/preferencesStore";
import type { UserPreferences } from "@/types/auth";
import { renderHook } from "@/test/render";
import { beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import {
  BasisContext,
  type ReportingBasis,
} from "@/components/reports/ReportingBasisContext";
import { useReportExportMetadata } from "./useReportExportMetadata";
import { exportToCsv, exportCsvSections } from "@/lib/csv-export";
vi.mock("@/lib/csv-export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/csv-export")>()),
  exportToCsv: vi.fn(),
  exportCsvSections: vi.fn(),
}));
beforeEach(() => { usePreferencesStore.setState({preferences:{accrualEnabled:true} as UserPreferences}); });
const wrapper = (basis: ReportingBasis) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <BasisContext.Provider
        value={{
          basis,
          selection: basis,
          choose: vi.fn(),
          showDetails: () => false,
        }}
      >
        {children}
      </BasisContext.Provider>
    );
  };
it("labels CSV and PDF payloads with the selected basis without changing values", () => {
  const { result } = renderHook(() => useReportExportMetadata(), {
    wrapper: wrapper("accrual"),
  });
  result.current.exportCsvWithBasis("report", ["Amount"], [["-100.0001"]]);
  expect(exportToCsv).toHaveBeenLastCalledWith(
    "report",
    ["Amount", "Reporting basis"],
    [["-100.0001", "Accrual"]],
  );
  expect(
    result.current.withPdfBasis({
      title: "Report",
      filename: "report",
      description: "Period detail",
    }),
  ).toMatchObject({ description: "Period detail\nReporting basis: Accrual" });
});
it("keeps payment-specific exports cash even under an accrual user default", () => {
  const { result } = renderHook(() => useReportExportMetadata("cash"), {
    wrapper: wrapper("accrual"),
  });
  result.current.exportSectionsWithBasis("cash-report", [
    { title: "Payments", headers: ["Amount"], rows: [[0]] },
  ]);
  expect(exportCsvSections).toHaveBeenLastCalledWith("cash-report", [
    {
      title: "Payments · Reporting basis: Cash",
      headers: ["Amount"],
      rows: [[0]],
    },
  ]);
});
it("keeps standalone exporter behavior until a reporting scope supplies a basis", () => {
  const { result } = renderHook(() => useReportExportMetadata());
  result.current.exportCsvWithBasis("report", ["Amount"], [[0]]);
  expect(exportToCsv).toHaveBeenLastCalledWith("report", ["Amount"], [[0]]);
});

it("preserves the existing export shape while the feature is disabled", () => {
  usePreferencesStore.setState({preferences:{accrualEnabled:false} as UserPreferences});
  const {result}=renderHook(()=>useReportExportMetadata(),{wrapper:wrapper("cash")});
  result.current.exportCsvWithBasis("report",["Amount"],[[5]]);
  expect(exportToCsv).toHaveBeenLastCalledWith("report",["Amount"],[[5]]);
  const options={title:"Report",filename:"report"};
  expect(result.current.withPdfBasis(options)).toEqual(options);
});
