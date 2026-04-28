export const TierMode = {
  T0_ONLY: "t0-only",
  T1_ONLY: "t1-only"
} as const;

export type TierMode = (typeof TierMode)[keyof typeof TierMode];

export const defaultTierMode = TierMode.T1_ONLY;
