export type JitPassStats = Readonly<Record<string, number>>;

export type JitNamedPassStats = Readonly<{
  name: string;
  changed: boolean;
  stats: JitPassStats;
}>;

export type JitPassStatsByName = Readonly<Record<string, JitPassStats>>;

export function jitPassChangedFromStats(stats: JitPassStats): boolean {
  return Object.values(stats).some((value) => value !== 0);
}

export function collectJitPassStats(results: readonly JitNamedPassStats[]): JitPassStatsByName {
  const byName: Record<string, JitPassStats> = {};

  for (const result of results) {
    byName[result.name] = result.stats;
  }

  return byName;
}

export function sumJitPassStats(results: readonly JitNamedPassStats[]): JitPassStats {
  const totals: Record<string, number> = {};

  for (const result of results) {
    for (const [key, value] of Object.entries(result.stats)) {
      totals[key] = (totals[key] ?? 0) + value;
    }
  }

  return totals;
}
