export type JitTrackedOptimizationStats = Readonly<{
  instructionsWalked: number;
  opsWalked: number;
  flagSourceCount: number;
  flagReadCount: number;
  sourceClobberCount: number;
  registerProducerCount: number;
  registerReadCount: number;
  registerClobberCount: number;
  registerMaterializedSetCount: number;
}>;
