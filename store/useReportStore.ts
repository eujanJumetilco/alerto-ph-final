// store/useUserStore.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Report {
  id: string;
  title: string;
  referenceNumber: string;
}

interface ReportState {
  report: Report | null;
  setReport: (report: Report) => void;
  clearReport: () => void;
}

export const useReportStore = create<ReportState>()(
  persist(
    (set) => ({
      report: null,
      setReport: (report) => set({ report }),
      clearReport: () => set({ report: null }),
    }),
    {
    name: "alerto-report", // key in localStorage
    }
  )
);