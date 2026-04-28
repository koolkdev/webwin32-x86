export const TierMode = {
  T0_ONLY: "t0-only",
  T1_ONLY: "t1-only",
  T2_ONLY: "t2-only"
} as const;

export type TierMode = (typeof TierMode)[keyof typeof TierMode];

export const defaultTierMode = TierMode.T1_ONLY;
