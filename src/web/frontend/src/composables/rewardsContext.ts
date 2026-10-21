import { inject, type InjectionKey, type Ref } from "vue";
import type { useDailyRewards } from "./useDailyRewards";
import type { ItemCatalog } from "../utils/minecraftItems";

/** What the editor's parts share: the document state and how it is shown. */
export interface RewardsContext {
  rewards: ReturnType<typeof useDailyRewards>;
  catalog: Ref<ItemCatalog | null>;
  /** Whether the viewer may change this document. */
  editable: Ref<boolean>;
  /** Whether chances are edited as a percent or as a raw weight. */
  mode: Ref<"percent" | "weight">;
}

export const REWARDS_CONTEXT: InjectionKey<RewardsContext> = Symbol("rewards");

export function useRewardsContext(): RewardsContext {
  const context = inject(REWARDS_CONTEXT);
  if (!context) throw new Error("The rewards editor's parts must be used inside RewardsView.");
  return context;
}
