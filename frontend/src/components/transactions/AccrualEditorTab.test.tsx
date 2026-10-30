import { act, renderHook, render, screen, waitFor, fireEvent } from "@/test/render";
import { beforeEach, expect, it, vi } from "vitest";
import { accrualsApi } from "@/lib/accruals";
import { AccrualEditorTab, useAccrualEditorDraft } from "./AccrualEditorTab";
import { AccrualPlanTable } from "./AccrualPreviewTable";
vi.mock("@/lib/accruals", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/accruals")>()),
  accrualsApi: {
    sourceSchedules: vi.fn(),
    editorPreview: vi.fn(),
    editorSave: vi.fn(),
  },
}));
const value = { fingerprint: "reviewed-token", previews: [] };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(accrualsApi.sourceSchedules).mockResolvedValue([
    {
      id: "schedule",
      sourceSplitId: null,
      preset: "NTM",
      startMonth: "2026-06",
      monthCount: 12,
      revision: 1,
      family: "expense",
    },
  ]);
  vi.mocked(accrualsApi.editorPreview).mockResolvedValue(value);
  vi.mocked(accrualsApi.editorSave).mockResolvedValue({});
});
it("retains settings and reviews the unsaved source patch before a single combined save", async () => {
  const { result } = await act(async () =>
    renderHook(() => useAccrualEditorDraft("source")),
  );
  expect(result.current.hasSchedules).toBe(true);
  act(() =>
    result.current.update([
      {
        sourceTransactionId: "source",
        preset: "CUSTOM",
        startMonth: "2026-10",
        monthCount: 6,
      },
    ]),
  );
  expect(result.current.changed).toBe(true);
  let saved: boolean | undefined;
  await act(async () => {
    saved = await result.current.save({
      amount: -2400,
      transactionDate: "2026-10-15",
    });
  });
  expect(saved).toBe(false);
  expect(accrualsApi.editorSave).not.toHaveBeenCalled();
  expect(accrualsApi.editorPreview).toHaveBeenLastCalledWith("source", {
    patch: { amount: -2400, transactionDate: "2026-10-15" },
    settings: [
      {
        sourceTransactionId: "source",
        preset: "CUSTOM",
        startMonth: "2026-10",
        monthCount: 6,
      },
    ],
  });
  await act(async () => {
    saved = await result.current.save({
      amount: -2400,
      transactionDate: "2026-10-15",
    });
  });
  expect(saved).toBe(true);
  expect(accrualsApi.editorSave).toHaveBeenCalledWith(
    "source",
    expect.objectContaining({
      fingerprint: "reviewed-token",
      patch: { amount: -2400, transactionDate: "2026-10-15" },
    }),
  );
});
it("discards a preview arriving after any draft change", async () => {
  const { result } = await act(async () =>
    renderHook(() => useAccrualEditorDraft("source")),
  );
  let resolve!: (response: typeof value) => void;
  vi.mocked(accrualsApi.editorPreview).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  let pending!: Promise<unknown>;
  act(() => {
    pending = result.current.preview({ amount: -2400 });
  });
  act(() => result.current.invalidate());
  await act(async () => {
    resolve(value);
    await pending;
  });
  expect(result.current.value).toBeNull();
});
it("marks only the explored recognition month, and removes that mark when omitted", () => {
  const plan = {
    startMonth: "2026-10",
    monthCount: 2,
    amount: "-400",
    allocations: [
      { periodIndex: 0, recognitionDate: "2026-10-31", amount: "-200" },
      { periodIndex: 1, recognitionDate: "2026-11-30", amount: "-200" },
    ],
  };
  const { rerender } = render(
    <AccrualPlanTable plan={plan} currency="USD" highlightDate="2026-11-30" />,
  );
  expect(screen.getByRole("row", { selected: true })).toHaveTextContent(
    "11/30/2026",
  );
  rerender(<AccrualPlanTable plan={plan} currency="USD" />);
  expect(screen.queryByRole("row", { selected: true })).not.toBeInTheDocument();
});

it("exposes the chosen split to a submit closure from before the draft update", async () => {
  const {result}=renderHook(()=>useAccrualEditorDraft("source"));
  await waitFor(()=>expect(result.current.ready).toBe(true));
  const previous=result.current;
  await act(async()=>{previous.update([{sourceTransactionId:"source",sourceSplitId:"second-split",preset:"NTM"}]);});
  expect(previous.currentSettings()).toEqual([expect.objectContaining({sourceSplitId:"second-split"})]);
  await act(async()=>{await previous.preview({amount:-100});});
  expect(accrualsApi.editorPreview).toHaveBeenLastCalledWith("source",expect.objectContaining({settings:[expect.objectContaining({sourceSplitId:"second-split"})]}));
});

it("clears dirty state when schedule settings return to their original values", async () => {
  const {result}=await act(async()=>renderHook(()=>useAccrualEditorDraft("source")));
  const initial=result.current.settings;
  expect(result.current.dirty).toBe(false);
  await act(async()=>result.current.update(initial.map(setting=>({...setting,preset:"LTM"}))));
  expect(result.current.dirty).toBe(true);
  await act(async()=>result.current.update(initial));
  expect(result.current.dirty).toBe(false);
  expect(result.current.changed).toBe(true);
});

it("requires a fresh review after a stale combined save without automatically retrying", async () => {
  const {result} = await act(async () => renderHook(() => useAccrualEditorDraft("source")));
  const failure = {response:{status:409,data:{code:"ACCRUAL_REVIEW_REQUIRED"}}};
  vi.mocked(accrualsApi.editorSave).mockRejectedValueOnce(failure);
  await act(async () => { await expect(result.current.save({})).rejects.toBe(failure); });
  expect(result.current.value).toBeNull();
  expect(accrualsApi.editorSave).toHaveBeenCalledTimes(1);
  await act(async () => { expect(await result.current.save({})).toBe(false); });
  expect(accrualsApi.editorSave).toHaveBeenCalledTimes(1);
  await act(async () => { expect(await result.current.save({})).toBe(true); });
});
it("reviews removal with the combined source fingerprint before committing", async () => {
  const {result} = await act(async () => renderHook(() => useAccrualEditorDraft("source")));
  act(() => result.current.update(result.current.settings.map(setting => ({...setting,remove:true}))));
  await act(async () => { expect(await result.current.save({})).toBe(false); });
  expect(accrualsApi.editorSave).not.toHaveBeenCalled();
  expect(accrualsApi.editorPreview).toHaveBeenLastCalledWith("source",expect.objectContaining({settings:[expect.objectContaining({remove:true})]}));
  await act(async () => { expect(await result.current.save({})).toBe(true); });
  expect(accrualsApi.editorSave).toHaveBeenCalledWith("source",expect.objectContaining({fingerprint:"reviewed-token",settings:[expect.objectContaining({remove:true})]}));
});
function ActiveEditor() {
  const editor = useAccrualEditorDraft("source");
  return <AccrualEditorTab sourceId="source" paymentMonth="2026-06" components={[{id:null,label:"Income",family:"income"}]} editor={editor} onPreview={() => { void editor.preview({}); }} busy={false} />;
}
it("shows an actual lookup failure and recovers through the active tab retry", async () => {
  vi.mocked(accrualsApi.sourceSchedules).mockRejectedValueOnce(new Error("offline"));
  await act(async () => render(<ActiveEditor />));
  expect(screen.getByRole("alert")).toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"Preview"})).not.toBeInTheDocument();
  await act(async () => fireEvent.click(screen.getByRole("button",{name:"Retry"})));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Preview"})).toBeInTheDocument();
});
it("renders income timing balances and bounds custom duration in the active tab", async () => {
  vi.mocked(accrualsApi.editorPreview).mockResolvedValueOnce({fingerprint:"income",previews:[{
    fingerprint:"income",sourceSplitId:null,source:{transactionId:"source",splitId:null,amount:"1200",paymentDate:"2026-06-15",currencyCode:"USD",currencyDecimals:2},
    family:"income",before:null,expectedScheduleId:"schedule",expectedRevision:1,
    plan:{startMonth:"2026-06",monthCount:12,amount:"1200",allocations:[{periodIndex:0,recognitionDate:"2026-06-30",amount:"100"}]},
    timingBalances:[{asOf:"2026-06-30",amount:"1100"}],
  }]});
  await act(async () => render(<ActiveEditor />));
  expect(screen.getByText(/Unearned Revenue/i)).toBeInTheDocument();
  expect(screen.getByText("$1,100.0000")).toBeInTheDocument();
  const preset = screen.getAllByRole("combobox")[0];
  await act(async () => fireEvent.change(preset,{target:{value:"CUSTOM"}}));
  const duration = screen.getByLabelText("Number of months");
  expect(duration).toHaveAttribute("inputmode","decimal");
  await act(async () => fireEvent.change(duration,{target:{value:"601"}}));
  await act(async () => fireEvent.blur(duration));
  expect(duration).toHaveValue("600");
});
