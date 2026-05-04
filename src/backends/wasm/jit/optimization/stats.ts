export type JitPassStats = Readonly<Record<string, number>>;

export type JitNamedPassStats<TName extends string = string> = Readonly<{
  name: TName;
  changed: boolean;
  stats: JitPassStats;
}>;

export type JitPassStatsByName<TName extends string = string> = Readonly<Record<TName, JitPassStats>>;

export function jitPassChangedFromStats(stats: JitPassStats): boolean {
  return Object.values(stats).some((value) => value !== 0);
}

export function collectJitPassStats<TName extends string>(
  results: readonly JitNamedPassStats<TName>[]
): JitPassStatsByName<TName> {
  const byName: Record<string, JitPassStats> = {};

  for (const result of results) {
    byName[result.name] = addJitPassStats(byName[result.name] ?? {}, result.stats);
  }

  return byName as Record<TName, JitPassStats>;
}

function addJitPassStats(left: JitPassStats, right: JitPassStats): JitPassStats {
  const totals: Record<string, number> = { ...left };

  for (const [key, value] of Object.entries(right)) {
    totals[key] = (totals[key] ?? 0) + value;
  }

  return totals;
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
