import { create } from "zustand";
import { persist } from "zustand/middleware";
import { sampleCouple } from "./defaults";
import type { PlanInput } from "./types";

type PlanStore = {
  plan: PlanInput;
  setPlan: (plan: PlanInput) => void;
  update: (fn: (plan: PlanInput) => PlanInput) => void;
};

export const usePlanStore = create<PlanStore>()(
  persist(
    (set) => ({
      plan: sampleCouple(),
      setPlan: (plan) => set({ plan }),
      update: (fn) => set((s) => ({ plan: fn(s.plan) })),
    }),
    { name: "alder-plan-v1", skipHydration: true },
  ),
);
