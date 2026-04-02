export function formatMonthLabel(monthKey) {
  const [year, month] = monthKey.split("-");
  return `${year}.${month}`;
}

export function formatPeriodRangeLabel(startMonthKey, endMonthKey) {
  if (!startMonthKey || !endMonthKey) return "-";
  return `${formatMonthLabel(startMonthKey)} ~ ${formatMonthLabel(endMonthKey)}`;
}

export function formatPerformance(value) {
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPercent(value) {
  if (value == null) return "-";
  return `${value.toFixed(1)}%`;
}

export function getRankDelta(previousRank, currentRank) {
  if (!previousRank) {
    return {
      label: "*",
      tone: "bg-slate-100 text-slate-500",
    };
  }

  if (previousRank === currentRank) {
    return {
      label: "•",
      tone: "bg-slate-100 text-slate-500",
    };
  }

  if (previousRank > currentRank) {
    return {
      label: `▲${previousRank - currentRank}`,
      tone: "bg-emerald-100 text-emerald-700",
    };
  }

  return {
    label: `▼${currentRank - previousRank}`,
    tone: "bg-rose-100 text-rose-700",
  };
}

export function getGapTone(value) {
  if (value > 0) return "text-emerald-700";
  if (value < 0) return "text-rose-700";
  return "text-slate-500";
}

export function buildPeriodMap(records, periodMode, dimensionKey) {
  const periodMap = new Map();

  records.forEach((record) => {
    const periodKey = periodMode === "yearly" ? String(record.year) : record.monthKey;
    const dimensionName = record[dimensionKey];
    const periodEntry = periodMap.get(periodKey) ?? {
      periodKey,
      dimensions: new Map(),
      totalPerformance: 0,
      truncatedTotalPerformance: 0,
    };

    periodEntry.totalPerformance += record.performanceThousandKrw;
    periodEntry.truncatedTotalPerformance += Math.trunc(record.performanceThousandKrw);
    periodEntry.dimensions.set(
      dimensionName,
      (periodEntry.dimensions.get(dimensionName) ?? 0) + record.performanceThousandKrw
    );
    periodMap.set(periodKey, periodEntry);
  });

  return periodMap;
}

export function buildMonthlyTotals(records) {
  const monthlyTotalsMap = new Map();

  records.forEach((record) => {
    const monthKey = record.monthKey;
    const current = monthlyTotalsMap.get(monthKey) ?? {
      totalPerformance: 0,
      truncatedTotalPerformance: 0,
    };

    current.totalPerformance += record.performanceThousandKrw;
    current.truncatedTotalPerformance += Math.trunc(record.performanceThousandKrw);
    monthlyTotalsMap.set(monthKey, current);
  });

  return new Map([...monthlyTotalsMap.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export function buildPieSlices(currentPeriod, chartColors, otherBucketName = "기타") {
  const ranked = [...currentPeriod.dimensions.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const topSlices = ranked.slice(0, 8);
  const otherTotal = ranked.slice(8).reduce((sum, item) => sum + item.value, 0);
  const slices = otherTotal > 0 ? [...topSlices, { name: otherBucketName, value: otherTotal }] : topSlices;
  const total = slices.reduce((sum, item) => sum + item.value, 0);

  return slices.map((slice, index) => ({
    ...slice,
    share: total ? (slice.value / total) * 100 : 0,
    color: chartColors[index % chartColors.length],
  }));
}

export function summarizeNames(names) {
  const uniqueNames = [...new Set(names)].filter(Boolean).sort();
  if (!uniqueNames.length) return "";
  if (uniqueNames.length <= 2) return uniqueNames.join(", ");
  return `${uniqueNames.slice(0, 2).join(", ")} 외 ${uniqueNames.length - 2}`;
}
