import { useEffect, useRef, useState } from "react";
import {
  buildDashboardData,
  fetchDashboardIndex,
  fetchDashboardYearRecords,
  getRequiredYears,
} from "../lib/dashboardData";

const CHART_COLORS = ["#0f766e", "#ea580c", "#2563eb", "#dc2626", "#7c3aed", "#0891b2"];
const ALL_INSURERS_NAME = "__ALL__";
const OVERALL_TABLE_ROW_LIMIT = 100;
const DETAIL_TABLE_ROW_LIMIT = 20;
const OTHER_BUCKET_NAME = "기타";

function formatMonthLabel(monthKey) {
  const [year, month] = monthKey.split("-");
  return `${year}.${month}`;
}

function formatPerformance(value) {
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value) {
  if (value == null) return "-";
  return `${value.toFixed(1)}%`;
}

function getRankDelta(previousRank, currentRank) {
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

function getGapTone(value) {
  if (value > 0) return "text-emerald-700";
  if (value < 0) return "text-rose-700";
  return "text-slate-500";
}

function buildPeriodMap(records, periodMode, dimensionKey) {
  const periodMap = new Map();

  records.forEach((record) => {
    const periodKey = periodMode === "yearly" ? String(record.year) : record.monthKey;
    const dimensionName = record[dimensionKey];
    const periodEntry = periodMap.get(periodKey) ?? {
      periodKey,
      dimensions: new Map(),
      totalPerformance: 0,
    };

    periodEntry.totalPerformance += record.performanceThousandKrw;
    periodEntry.dimensions.set(
      dimensionName,
      (periodEntry.dimensions.get(dimensionName) ?? 0) + record.performanceThousandKrw
    );
    periodMap.set(periodKey, periodEntry);
  });

  return periodMap;
}

function buildPieSlices(currentPeriod, chartColors) {
  const ranked = [...currentPeriod.dimensions.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const topSlices = ranked.slice(0, 8);
  const otherTotal = ranked.slice(8).reduce((sum, item) => sum + item.value, 0);
  const slices = otherTotal > 0 ? [...topSlices, { name: OTHER_BUCKET_NAME, value: otherTotal }] : topSlices;
  const total = slices.reduce((sum, item) => sum + item.value, 0);

  return slices.map((slice, index) => ({
    ...slice,
    share: total ? (slice.value / total) * 100 : 0,
    color: chartColors[index % chartColors.length],
  }));
}

function summarizeNames(names) {
  const uniqueNames = [...new Set(names)].filter(Boolean).sort();
  if (!uniqueNames.length) return "";
  if (uniqueNames.length <= 2) return uniqueNames.join(", ");
  return `${uniqueNames.slice(0, 2).join(", ")} 외 ${uniqueNames.length - 2}`;
}

function buildProductMixSlices(records, activePeriodKey, periodMode, insurerNames, gaNames, chartColors) {
  const insurerNameSet = new Set(Array.isArray(insurerNames) ? insurerNames : [insurerNames]);
  const gaNameSet = new Set(Array.isArray(gaNames) ? gaNames : [gaNames]);
  const grouped = new Map();
  const productInsurerMap = new Map();

  records
    .filter((record) => {
      const periodKey = periodMode === "yearly" ? String(record.year) : record.monthKey;
      if (periodKey !== activePeriodKey) return false;
      if (insurerNameSet.size > 0 && !insurerNameSet.has(record.insurerName)) return false;
      if (gaNameSet.size > 0 && !gaNameSet.has(record.gaName)) return false;
      return true;
    })
    .forEach((record) => {
      const key = record.productName || OTHER_BUCKET_NAME;
      grouped.set(key, (grouped.get(key) ?? 0) + record.performanceThousandKrw);
      const insurerSet = productInsurerMap.get(key) ?? new Set();
      insurerSet.add(record.insurerName);
      productInsurerMap.set(key, insurerSet);
    });

  const slices = buildPieSlices(
    {
      dimensions: grouped,
    },
    chartColors
  );

  return slices.map((slice) => ({
    ...slice,
    insurerLabel: summarizeNames([...(productInsurerMap.get(slice.name) ?? [])]),
  }));
}

function buildInsurerDashboardState(
  dashboardData,
  selectedInsurerName,
  selectedSheetName,
  periodMode,
  selectedPeriodKey
) {
  const isAllInsurersView = selectedInsurerName === ALL_INSURERS_NAME;
  const selectedSheet = dashboardData.sheets.find((item) => item.sheetName === selectedSheetName) ?? dashboardData.sheets[0];
  const isProductSheet = selectedSheet?.hasProductTypes ?? false;
  const sheetRecords = dashboardData.records.filter((item) => item.sheetName === selectedSheet.sheetName);
  const insurerRecords = isAllInsurersView
    ? sheetRecords
    : sheetRecords.filter((item) => item.insurerName === selectedInsurerName);
  const dimensionKey = isAllInsurersView ? "insurerName" : "gaName";
  const dimensionLabel = isAllInsurersView ? "보험사" : "GA명";
  const availableYears = [...new Set(insurerRecords.map((item) => item.year))].sort();
  const periodMap = buildPeriodMap(insurerRecords, periodMode, dimensionKey);
  const periods = [...periodMap.keys()].sort();
  const activePeriodKey = periods.includes(selectedPeriodKey) ? selectedPeriodKey : periods.at(-1) ?? "";
  const currentPeriodIndex = periods.indexOf(activePeriodKey);
  const previousPeriodKey = currentPeriodIndex > 0 ? periods[currentPeriodIndex - 1] : null;
  const priorPeriods = currentPeriodIndex > 0
    ? periodMode === "yearly"
      ? periods.slice(0, currentPeriodIndex)
      : periods.slice(Math.max(0, currentPeriodIndex - 12), currentPeriodIndex)
    : [];
  const recentPeriods = periods.slice(Math.max(0, currentPeriodIndex - 2), currentPeriodIndex + 1);
  const currentPeriod = periodMap.get(activePeriodKey) ?? {
    dimensions: new Map(),
    totalPerformance: 0,
  };
  const previousPeriod = previousPeriodKey
    ? periodMap.get(previousPeriodKey) ?? { dimensions: new Map(), totalPerformance: 0 }
    : { dimensions: new Map(), totalPerformance: 0 };

  const currentRanked = [...currentPeriod.dimensions.entries()]
    .map(([name, performance]) => ({ name, performance }))
    .sort((a, b) => b.performance - a.performance);
  const previousRankMap = new Map(
    [...previousPeriod.dimensions.entries()]
      .map(([name, performance]) => ({ name, performance }))
      .sort((a, b) => b.performance - a.performance)
      .map((item, index) => [item.name, index + 1])
  );

  const visibleRanked = isAllInsurersView
    ? currentRanked.slice(0, OVERALL_TABLE_ROW_LIMIT)
    : currentRanked.slice(0, DETAIL_TABLE_ROW_LIMIT);
  const otherRanked = isAllInsurersView ? [] : currentRanked.slice(DETAIL_TABLE_ROW_LIMIT);
  const rankedRows = otherRanked.length
    ? [
        ...visibleRanked,
        {
          name: OTHER_BUCKET_NAME,
          performance: otherRanked.reduce((sum, item) => sum + item.performance, 0),
          memberNames: otherRanked.map((item) => item.name),
          isOtherBucket: true,
        },
      ]
    : visibleRanked;

  const tableRows = rankedRows.map((item, index) => {
    const rank = index + 1;
    const currentMs = currentPeriod.totalPerformance > 0
      ? (item.performance / currentPeriod.totalPerformance) * 100
      : 0;
    const hasBenchmarkData = periodMode === "yearly"
      ? availableYears.length >= 2 && priorPeriods.length >= 1
      : availableYears.length >= 2 && priorPeriods.length >= 12;
    const benchmarkMs = hasBenchmarkData
      ? priorPeriods.reduce((sum, periodKey) => {
          const periodEntry = periodMap.get(periodKey);
          const periodTotal = periodEntry?.totalPerformance ?? 0;
          const periodPerformance = item.isOtherBucket
            ? (item.memberNames ?? []).reduce(
                (memberSum, memberName) => memberSum + (periodEntry?.dimensions.get(memberName) ?? 0),
                0
              )
            : (periodEntry?.dimensions.get(item.name) ?? 0);
          if (!periodTotal) return sum;
          return sum + (periodPerformance / periodTotal) * 100;
        }, 0) / priorPeriods.length
      : null;

    return {
      rank,
      name: item.name,
      performance: item.performance,
      memberNames: item.memberNames ?? [item.name],
      currentMs,
      benchmarkMs,
      gap: benchmarkMs == null ? null : currentMs - benchmarkMs,
      delta: item.isOtherBucket ? getRankDelta(null, rank) : getRankDelta(previousRankMap.get(item.name) ?? null, rank),
      isOtherBucket: Boolean(item.isOtherBucket),
    };
  });

  const chartRowMap = new Map(tableRows.map((row) => [row.name, row]));
  const chartNames = tableRows.slice(0, 5).map((item) => item.name);

  const chartSeries = chartNames.map((name, index) => ({
    name,
    color: CHART_COLORS[index % CHART_COLORS.length],
    points: recentPeriods.map((periodKey) => {
      const periodEntry = periodMap.get(periodKey);
      const periodTotal = periodEntry?.totalPerformance ?? 0;
      const memberNames = chartRowMap.get(name)?.memberNames ?? [name];
      const performance = memberNames.reduce(
        (sum, memberName) => sum + (periodEntry?.dimensions.get(memberName) ?? 0),
        0
      );
      return {
        periodKey,
        ms: periodTotal ? (performance / periodTotal) * 100 : 0,
      };
    }),
  }));

  const topBenchmarkMs = tableRows[0]?.benchmarkMs ?? null;
  const priorTotalPerformance = periodMode === "yearly"
    ? (previousPeriodKey ? (periodMap.get(previousPeriodKey)?.totalPerformance ?? null) : null)
    : priorPeriods.length >= 12
      ? priorPeriods.reduce((sum, periodKey) => sum + (periodMap.get(periodKey)?.totalPerformance ?? 0), 0)
      : null;

  return {
    isAllInsurersView,
    selectedSheet,
    isProductSheet,
    dimensionLabel,
    periods,
    activePeriodKey,
    recentPeriods,
    totalPerformance: currentPeriod.totalPerformance,
    topBenchmarkMs,
    priorTotalPerformance,
    tableRows,
    chartSeries,
    chartTitle: isAllInsurersView
        ? periodMode === "yearly"
          ? "최근 3개년 TOP 5 보험사별 MS 추이"
          : "최근 3개월 TOP 5 보험사별 MS 추이"
        : periodMode === "yearly"
          ? "TOP 5 GA 최근 3개년 MS 추이"
          : "TOP 5 GA 최근 3개월 MS 추이",
    pieChartTitle: isAllInsurersView
      ? "전체 보험사 상품군 비중"
      : `${selectedInsurerName} 상품군 비중`,
    tableTitle: isAllInsurersView
      ? "전체 보험사 순위"
      : `${selectedInsurerName} 판매 GA Top 20`,
    benchmarkLabel: periodMode === "yearly" ? "전년 MS(%)" : "직전 1년 평균 MS(%)",
    deltaLabel: periodMode === "yearly" ? "전년 대비" : "전월 대비",
    summaryName: isAllInsurersView ? "전체" : selectedInsurerName,
    pieSlices: isProductSheet
      ? buildProductMixSlices(
          sheetRecords,
          activePeriodKey,
          periodMode,
          isAllInsurersView ? [] : [selectedInsurerName],
          [],
          CHART_COLORS
        )
      : [],
  };
}

function DashboardChart({
  recentPeriods,
  chartSeries,
  highlightedName,
  onHoverName,
  onLeaveName,
  chartTitle,
  periodMode,
}) {
  const width = 520;
  const height = 320;
  const padding = { top: 24, right: 18, bottom: 40, left: 44 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(5, ...chartSeries.flatMap((series) => series.points.map((point) => point.ms)));

  return (
    <div className="rounded-[2rem] border border-slate-200 bg-[linear-gradient(180deg,#fff7ed_0%,#ffffff_56%)] p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-orange-600">
            {periodMode === "yearly" ? "Recent 3 Years" : "Recent 3 Months"}
          </p>
          <h3 className="mt-1 whitespace-nowrap text-lg font-semibold text-slate-900">
            {chartTitle}
          </h3>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {chartSeries.map((series) => {
            const isActive = highlightedName === series.name;
            return (
              <button
                key={series.name}
                type="button"
                onMouseEnter={() => onHoverName(series.name)}
                onMouseLeave={onLeaveName}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  isActive
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-600"
                }`}
              >
                {series.name}
              </button>
            );
          })}
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="h-[320px] w-full">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padding.top + plotHeight * ratio;
          const label = ((1 - ratio) * maxValue).toFixed(0);
          return (
            <g key={ratio}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="#e2e8f0" strokeDasharray="4 6" />
              <text x={padding.left - 10} y={y + 4} textAnchor="end" fontSize="11" fill="#64748b">
                {label}%
              </text>
            </g>
          );
        })}

        {recentPeriods.map((periodKey, index) => {
          const x = recentPeriods.length === 1
            ? padding.left + plotWidth / 2
            : padding.left + (plotWidth / (recentPeriods.length - 1)) * index;
          return (
            <g key={periodKey}>
              <text x={x} y={height - 12} textAnchor="middle" fontSize="12" fill="#475569">
                {periodMode === "yearly" ? periodKey : formatMonthLabel(periodKey)}
              </text>
            </g>
          );
        })}

        {chartSeries.map((series) => {
          const isActive = highlightedName === series.name;
          const path = series.points.map((point, index) => {
            const x = series.points.length === 1
              ? padding.left + plotWidth / 2
              : padding.left + (plotWidth / (series.points.length - 1)) * index;
            const y = padding.top + plotHeight - (point.ms / maxValue) * plotHeight;
            return `${index === 0 ? "M" : "L"} ${x} ${y}`;
          }).join(" ");

          return (
            <g
              key={series.name}
              onMouseEnter={() => onHoverName(series.name)}
              onMouseLeave={onLeaveName}
            >
              <path
                d={path}
                fill="none"
                stroke={series.color}
                strokeWidth={isActive ? 4 : 2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={highlightedName && !isActive ? 0.25 : 1}
              />
              {series.points.map((point) => {
                const index = series.points.indexOf(point);
                const x = series.points.length === 1
                  ? padding.left + plotWidth / 2
                  : padding.left + (plotWidth / (series.points.length - 1)) * index;
                const y = padding.top + plotHeight - (point.ms / maxValue) * plotHeight;
                return (
                  <circle
                    key={`${series.name}-${point.periodKey}`}
                    cx={x}
                    cy={y}
                    r={isActive ? 5 : 4}
                    fill={series.color}
                    opacity={highlightedName && !isActive ? 0.25 : 1}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function PieChart({ title, slices }) {
  const radius = 86;
  const centerX = 130;
  const centerY = 130;
  let cumulative = 0;

  const arcs = slices.map((slice) => {
    const startAngle = cumulative * Math.PI * 2;
    cumulative += slice.share / 100;
    const endAngle = cumulative * Math.PI * 2;
    const x1 = centerX + radius * Math.sin(startAngle);
    const y1 = centerY - radius * Math.cos(startAngle);
    const x2 = centerX + radius * Math.sin(endAngle);
    const y2 = centerY - radius * Math.cos(endAngle);
    const largeArcFlag = endAngle - startAngle > Math.PI ? 1 : 0;
    const path = [
      `M ${centerX} ${centerY}`,
      `L ${x1} ${y1}`,
      `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`,
      "Z",
    ].join(" ");
    return { ...slice, path };
  });

  return (
    <div className="rounded-[2rem] border border-slate-200 bg-[linear-gradient(180deg,#fff7ed_0%,#ffffff_56%)] p-4">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-orange-600">Product Mix</p>
        <h3 className="mt-1 text-lg font-semibold text-slate-900">{title}</h3>
      </div>
      <div className="space-y-4">
        <svg viewBox="0 0 260 260" className="mx-auto h-[260px] w-[260px]">
          {arcs.map((arc) => (
            <path key={arc.name} d={arc.path} fill={arc.color} stroke="#ffffff" strokeWidth="2" />
          ))}
          <circle cx={centerX} cy={centerY} r="44" fill="#ffffff" />
          <text x={centerX} y={centerY - 2} textAnchor="middle" fontSize="13" fontWeight="700" fill="#0f172a">
            상품군
          </text>
          <text x={centerX} y={centerY + 18} textAnchor="middle" fontSize="11" fill="#64748b">
            비중
          </text>
        </svg>
        <div className="space-y-2">
          {slices.map((slice) => (
            <div key={slice.name} className="flex items-start justify-between gap-3 rounded-2xl bg-white px-3 py-2">
              <div className="flex min-w-0 items-start gap-3">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: slice.color }} />
                <div className="min-w-0">
                  <div className="text-sm font-semibold leading-5 text-slate-900 break-words">
                    {slice.name}
                  </div>
                  {slice.insurerLabel ? (
                    <div className="mt-0.5 text-xs leading-4 text-slate-500 break-words">
                      {slice.insurerLabel}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-semibold text-slate-900">{formatPercent(slice.share)}</div>
                <div className="text-xs text-slate-500">{formatPerformance(slice.value)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function InsurerPerformancePage() {
  const [dashboardIndex, setDashboardIndex] = useState(null);
  const [yearRecordsMap, setYearRecordsMap] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedInsurerName, setSelectedInsurerName] = useState(ALL_INSURERS_NAME);
  const [selectedSheetName, setSelectedSheetName] = useState("월초");
  const [selectedYear, setSelectedYear] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [insurerSearchText, setInsurerSearchText] = useState("전체");
  const [isInsurerSelectorOpen, setIsInsurerSelectorOpen] = useState(false);
  const [isYearSelectorOpen, setIsYearSelectorOpen] = useState(false);
  const [isMonthSelectorOpen, setIsMonthSelectorOpen] = useState(false);
  const [isSheetSelectorOpen, setIsSheetSelectorOpen] = useState(false);
  const [hoveredGAName, setHoveredGAName] = useState("");
  const insurerSelectorRef = useRef(null);
  const yearSelectorRef = useRef(null);
  const monthSelectorRef = useRef(null);
  const sheetSelectorRef = useRef(null);

  useEffect(() => {
    let isCancelled = false;

    async function loadDashboardIndex() {
      setIsLoading(true);
      setLoadError("");

      try {
        const payload = await fetchDashboardIndex();
        if (isCancelled) return;

        const latestMonthKey = payload.availableMonths.at(-1) ?? "";
        const [latestYear, latestMonth] = latestMonthKey.split("-");
        setDashboardIndex(payload);
        setSelectedSheetName(payload.sheets.find((item) => item.sheetName === "월초")?.sheetName ?? payload.sheets[0]?.sheetName ?? "");
        setSelectedYear(latestYear ?? "");
        setSelectedMonth(latestMonth ?? "");
      } catch (error) {
        if (isCancelled) return;
        setLoadError(error.message ?? "대시보드 데이터를 불러오지 못했습니다.");
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadDashboardIndex();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function loadYearRecords() {
      if (!dashboardIndex || !selectedYear) return;

      setIsLoading(true);
      setLoadError("");

      try {
        const requiredYears = getRequiredYears(dashboardIndex, selectedYear);
        const nextYearRecordsMap = {};

        for (const year of requiredYears) {
          nextYearRecordsMap[year] = await fetchDashboardYearRecords(year);
          if (isCancelled) return;
        }

        if (isCancelled) return;
        setYearRecordsMap(nextYearRecordsMap);
      } catch (error) {
        if (isCancelled) return;
        setLoadError(error.message ?? "대시보드 데이터를 불러오지 못했습니다.");
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadYearRecords();

    return () => {
      isCancelled = true;
    };
  }, [dashboardIndex, selectedYear]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!insurerSelectorRef.current?.contains(event.target)) {
        setIsInsurerSelectorOpen(false);
      }
      if (!yearSelectorRef.current?.contains(event.target)) {
        setIsYearSelectorOpen(false);
      }
      if (!monthSelectorRef.current?.contains(event.target)) {
        setIsMonthSelectorOpen(false);
      }
      if (!sheetSelectorRef.current?.contains(event.target)) {
        setIsSheetSelectorOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const dashboardData = dashboardIndex ? buildDashboardData(dashboardIndex, yearRecordsMap) : null;
  const allYears = dashboardIndex
    ? [...(dashboardIndex.availableYears ?? [])].map((item) => String(item)).sort()
    : [];
  const availableMonthsForYear = dashboardIndex
    ? [...new Set(
        (dashboardIndex.availableMonths ?? [])
          .filter((monthKey) => monthKey.startsWith(`${selectedYear}-`))
          .map((monthKey) => monthKey.split("-")[1])
      )].sort()
    : [];
  const periodMode = selectedMonth === "all" ? "yearly" : "monthly";
  const selectedPeriodKey = periodMode === "yearly" ? selectedYear : `${selectedYear}-${selectedMonth}`;
  const insurerOptions = dashboardData
    ? [
        { insurerName: ALL_INSURERS_NAME, label: "전체" },
        ...[...new Set(dashboardData.records.map((item) => item.insurerName))]
          .sort()
          .map((insurerName) => ({ insurerName, label: insurerName })),
      ]
    : [];
  const filteredInsurers = insurerOptions.filter((item) => {
    const keyword = insurerSearchText.trim().toLowerCase();
    if (!keyword) return true;
    return item.label.toLowerCase().includes(keyword);
  });
  const availableSheets = dashboardData?.sheets.filter((sheet) =>
    selectedInsurerName === ALL_INSURERS_NAME ||
    dashboardData.records.some(
      (record) => record.sheetName === sheet.sheetName && record.insurerName === selectedInsurerName
    )
  ) ?? [];

  useEffect(() => {
    if (!allYears.length) return;
    if (allYears.includes(selectedYear)) return;
    setSelectedYear(allYears.at(-1) ?? "");
  }, [allYears, selectedYear]);

  useEffect(() => {
    if (!availableMonthsForYear.length) return;
    if (selectedMonth === "all") return;
    if (availableMonthsForYear.includes(selectedMonth)) return;
    setSelectedMonth(availableMonthsForYear.at(-1) ?? "");
  }, [availableMonthsForYear, selectedMonth]);

  useEffect(() => {
    if (!availableSheets.length) return;
    if (availableSheets.some((sheet) => sheet.sheetName === selectedSheetName)) return;
    setSelectedSheetName(availableSheets[0].sheetName);
  }, [availableSheets, selectedSheetName]);

  const dashboardState = dashboardData
    ? buildInsurerDashboardState(
        dashboardData,
        selectedInsurerName,
        selectedSheetName,
        periodMode,
        selectedPeriodKey
      )
    : null;

  if (isLoading) {
    return (
      <div className="rounded-[2rem] border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500 shadow-sm">
        보험사별 대시보드 데이터를 불러오는 중입니다.
      </div>
    );
  }

  if (loadError || !dashboardData || !dashboardState) {
    return (
      <div className="rounded-[2rem] border border-rose-200 bg-rose-50 px-6 py-12 text-center text-sm font-semibold text-rose-700 shadow-sm">
        {loadError || "대시보드 데이터를 불러오지 못했습니다."}
      </div>
    );
  }

  const chartSeriesNames = new Set(dashboardState.chartSeries.map((series) => series.name));
  const highlightedGANameCandidate = hoveredGAName;
  const highlightedGAName = chartSeriesNames.has(highlightedGANameCandidate)
    ? highlightedGANameCandidate
    : "";

  function selectInsurer(option) {
    setSelectedInsurerName(option.insurerName);
    setInsurerSearchText(option.label);
    setHoveredGAName("");
    setIsInsurerSelectorOpen(false);
  }

  return (
    <div className="space-y-6">
      <section className="overflow-visible rounded-[2rem] border border-slate-200 bg-[radial-gradient(circle_at_top_left,_#fff7ed,_#ffffff_55%),linear-gradient(135deg,#f8fafc,#ffffff)] p-6 shadow-sm">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-600">
              INSURER PERFORMANCE
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
              보험사 상세 분석
            </h1>
            <p className="mt-3 max-w-2xl text-xs leading-6 text-slate-500 sm:text-sm">
              * 본 자료는 보험저널에서 GA별로 취재, 집계된 데이터입니다.
            </p>

            <div className="mt-6 grid gap-3 lg:grid-cols-2">
              <div className="rounded-[1.5rem] bg-white/90 px-5 py-4 lg:col-span-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">선택 보험사</p>
                <p className="mt-2 text-xl font-semibold text-slate-900">{dashboardState.summaryName}</p>
              </div>
              <div className="rounded-[1.5rem] bg-white/90 px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  {periodMode === "yearly" ? "당해 실적" : "당월 실적"}
                </p>
                <p className="mt-2 text-xl font-semibold text-slate-900">
                  {formatPerformance(dashboardState.totalPerformance)}
                </p>
                <p className="mt-1 text-xs text-slate-400">단위: 천원, 소수점 포함 합산</p>
              </div>
              <div className="rounded-[1.5rem] bg-white/90 px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  직전1년 총합
                </p>
                <p className="mt-2 text-xl font-semibold text-slate-900">
                  {dashboardState.priorTotalPerformance == null
                    ? "-"
                    : formatPerformance(dashboardState.priorTotalPerformance)}
                </p>
                <p className="mt-1 text-xs text-slate-400">단위: 천원, 소수점 포함 합산</p>
              </div>
            </div>
          </div>

          <div className="w-full xl:w-[33rem] xl:self-end">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-2">
              <label className="rounded-2xl border border-slate-200 bg-white/85 px-3 py-2.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  연 선택
                </span>
                <div ref={yearSelectorRef} className="relative mt-1.5">
                  <button
                    type="button"
                    onClick={() => setIsYearSelectorOpen((current) => !current)}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-900"
                  >
                    <span>{selectedYear}</span>
                    <span className="text-slate-400">{isYearSelectorOpen ? "▲" : "▼"}</span>
                  </button>
                  {isYearSelectorOpen ? (
                    <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-30 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
                      <div className="max-h-80 overflow-y-auto py-1">
                        {allYears.map((year) => (
                          <button
                            key={year}
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => setSelectedYear(year)}
                            className={`flex w-full items-center justify-between gap-3 px-3 py-3 text-left text-sm transition hover:bg-orange-50 ${
                              year === selectedYear ? "bg-slate-50" : ""
                            }`}
                          >
                            <span className="font-semibold text-slate-900">{year}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </label>

              <label className="rounded-2xl border border-slate-200 bg-white/85 px-3 py-2.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  월 선택
                </span>
                <div ref={monthSelectorRef} className="relative mt-1.5">
                  <button
                    type="button"
                    onClick={() => setIsMonthSelectorOpen((current) => !current)}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-900"
                  >
                    <span>{selectedMonth === "all" ? "전체" : Number(selectedMonth || "0")}</span>
                    <span className="text-slate-400">{isMonthSelectorOpen ? "▲" : "▼"}</span>
                  </button>
                  {isMonthSelectorOpen ? (
                    <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-30 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
                      <div className="max-h-80 overflow-y-auto py-1">
                        {["all", ...availableMonthsForYear].map((month) => (
                          <button
                            key={month}
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => setSelectedMonth(month)}
                            className={`flex w-full items-center justify-between gap-3 px-3 py-3 text-left text-sm transition hover:bg-orange-50 ${
                              month === selectedMonth ? "bg-slate-50" : ""
                            }`}
                          >
                            <span className="font-semibold text-slate-900">
                              {month === "all" ? "전체" : Number(month)}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </label>

              <label className="rounded-2xl border border-slate-200 bg-white/85 px-3 py-2.5 sm:col-span-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  보험사 선택
                </span>
                <div ref={insurerSelectorRef} className="relative mt-1.5">
                  <input
                    type="text"
                    value={insurerSearchText}
                    onFocus={() => setIsInsurerSelectorOpen(true)}
                    onChange={(event) => {
                      setInsurerSearchText(event.target.value);
                      setIsInsurerSelectorOpen(true);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setIsInsurerSelectorOpen(false);
                        setInsurerSearchText(
                          insurerOptions.find((item) => item.insurerName === selectedInsurerName)?.label ?? "전체"
                        );
                      }
                      if (event.key === "Enter" && filteredInsurers[0]) {
                        event.preventDefault();
                        selectInsurer(filteredInsurers[0]);
                      }
                    }}
                    placeholder="보험사 입력"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none ring-0 placeholder:font-medium placeholder:text-slate-400 focus:border-orange-300"
                  />
                  {isInsurerSelectorOpen ? (
                    <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-30 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
                      <div className="max-h-80 overflow-y-auto py-1">
                        {filteredInsurers.map((item) => (
                          <button
                            key={item.insurerName}
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => selectInsurer(item)}
                            className={`flex w-full items-center justify-between gap-3 px-3 py-3 text-left text-sm transition hover:bg-orange-50 ${
                              item.insurerName === selectedInsurerName ? "bg-slate-50" : ""
                            }`}
                          >
                            <span className="font-semibold text-slate-900">{item.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </label>

              <label className="rounded-2xl border border-slate-200 bg-white/85 px-3 py-2.5 sm:col-span-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  시트 선택
                </span>
                <div ref={sheetSelectorRef} className="relative mt-1.5">
                  <button
                    type="button"
                    onClick={() => setIsSheetSelectorOpen((current) => !current)}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-900"
                  >
                    <span>{dashboardState.selectedSheet?.sheetName ?? selectedSheetName}</span>
                    <span className="text-slate-400">{isSheetSelectorOpen ? "▲" : "▼"}</span>
                  </button>
                  {isSheetSelectorOpen ? (
                    <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-30 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
                      <div className="max-h-80 overflow-y-auto py-1">
                        {availableSheets.map((sheet) => (
                          <button
                            key={sheet.sheetName}
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => setSelectedSheetName(sheet.sheetName)}
                            className={`flex w-full items-center justify-between gap-3 px-3 py-3 text-left text-sm transition hover:bg-orange-50 ${
                              sheet.sheetName === selectedSheetName ? "bg-slate-50" : ""
                            }`}
                          >
                            <span className="font-semibold text-slate-900">{sheet.sheetName}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </label>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-end justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Rank Table</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-900">{dashboardState.tableTitle}</h2>
            </div>
            <p className="text-sm text-slate-500">
              {periodMode === "yearly"
                ? `${dashboardState.activePeriodKey} 실적 기준`
                : `${formatMonthLabel(dashboardState.activePeriodKey)} 실적 기준`}
            </p>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-y-2 text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  <th className="px-3 py-2">순위</th>
                  <th className="px-3 py-2">{dashboardState.deltaLabel}</th>
                  <th className="px-3 py-2">{dashboardState.dimensionLabel}</th>
                  <th className="px-3 py-2 text-right">{periodMode === "yearly" ? "당해 MS" : "당월 MS"}</th>
                  <th className="px-3 py-2 text-right">실적(천원)</th>
                  <th className="px-3 py-2 text-right">{dashboardState.benchmarkLabel}</th>
                  <th className="px-3 py-2 text-right">Gap</th>
                </tr>
              </thead>
              <tbody>
                {dashboardState.tableRows.map((row) => {
                  const isHovered = hoveredGAName === row.name;
                  return (
                    <tr
                      key={row.name}
                      onMouseEnter={() => setHoveredGAName(row.name)}
                      onMouseLeave={() => setHoveredGAName("")}
                      className={`cursor-pointer rounded-2xl transition ${
                        isHovered
                          ? "bg-orange-50 shadow-[inset_0_0_0_1px_rgba(249,115,22,0.25)]"
                          : "bg-slate-50"
                      }`}
                    >
                      <td className="rounded-l-2xl px-3 py-3 font-semibold text-slate-900">{row.rank}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${row.delta.tone}`}>
                          {row.delta.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-semibold text-slate-900">
                        {row.name}
                      </td>
                      <td className="px-3 py-3 text-right font-medium text-slate-700">{formatPercent(row.currentMs)}</td>
                      <td className="px-3 py-3 text-right font-medium text-slate-700">{formatPerformance(row.performance)}</td>
                      <td className="px-3 py-3 text-right text-slate-500">{formatPercent(row.benchmarkMs)}</td>
                      <td className={`rounded-r-2xl px-3 py-3 text-right font-semibold ${getGapTone(row.gap ?? 0)}`}>
                        {row.gap == null ? "-" : `${row.gap > 0 ? "+" : ""}${row.gap.toFixed(1)}%p`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
            <ul className="list-disc space-y-1 pl-5">
              <li>실적: 천원 단위로 소수점을 포함해 합산한 값</li>
              <li>MS(%): 선택한 기간 내 기준 집합 총실적 대비 {dashboardState.dimensionLabel} 비중</li>
              <li>{dashboardState.deltaLabel}: 직전 기간 순위와 비교한 값</li>
              <li>{dashboardState.benchmarkLabel}: 이전 기준 기간의 평균 또는 전년 점유율 값</li>
              <li>Gap: 현재 MS에서 {dashboardState.benchmarkLabel.replace("(%)", "")}를 뺀 값</li>
              {dashboardState.isProductSheet ? <li>우측 파이차트: 선택 항목 내부의 상품군 비중</li> : null}
            </ul>
          </div>
        </div>

        <div className="space-y-6">
          <DashboardChart
            recentPeriods={dashboardState.recentPeriods}
            chartSeries={dashboardState.chartSeries}
            highlightedName={highlightedGAName}
            onHoverName={setHoveredGAName}
            onLeaveName={() => setHoveredGAName("")}
            chartTitle={dashboardState.chartTitle}
            periodMode={periodMode}
          />
          {dashboardState.isProductSheet ? (
            <PieChart
              title={dashboardState.pieChartTitle}
              slices={dashboardState.pieSlices}
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}
