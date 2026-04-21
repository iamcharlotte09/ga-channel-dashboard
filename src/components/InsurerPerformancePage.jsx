import { useEffect, useRef, useState } from "react";
import {
  buildDashboardData,
  fetchDashboardIndex,
  fetchDashboardYearRecords,
  getRequiredYears,
} from "../lib/dashboardData";
import {
  buildMonthlyTotals,
  buildPeriodMap,
  buildPieSlices,
  formatMonthLabel,
  formatPercent,
  formatPerformance,
  formatPeriodRangeLabel,
  getGapTone,
  getRankDelta,
  summarizeNames,
} from "../lib/dashboardFormatters";

const CHART_COLORS = ["#0f766e", "#ea580c", "#2563eb", "#dc2626", "#7c3aed", "#0891b2"];
const ALL_INSURERS_NAME = "__ALL__";
const ALL_SHEETS_NAME = "전체";
const OVERALL_TABLE_ROW_LIMIT = 100;
const DETAIL_TABLE_ROW_LIMIT = 20;
const OTHER_BUCKET_NAME = "기타";
const DISCREPANCY_ALL_SHEETS_KEY = "__ALL__";

function formatSelectionMonthLabel(selectedYear, selectedMonth) {
  if (!selectedYear) return "-";
  if (selectedMonth === "all") return `${selectedYear}년 전체`;
  if (!selectedMonth) return `${selectedYear}년`;
  return `${selectedYear}년 ${Number(selectedMonth)}월`;
}

function formatAggregationModeLabel(aggregationMode) {
  return aggregationMode === "decimal" ? "행별 소수점 포함" : "행별 소수점 제외";
}

function formatChangePercent(currentValue, previousValue) {
  if (!previousValue) return "비교 불가";
  const change = ((currentValue - previousValue) / previousValue) * 100;
  return `${change > 0 ? "+" : ""}${change.toFixed(1)}%`;
}

function getDiscrepancyNotes(discrepancies, periodMode, periodKey, sheetName, insurerName) {
  const periodDiscrepancies = discrepancies?.[periodMode === "yearly" ? "yearly" : "monthly"]?.[periodKey];
  if (!periodDiscrepancies) return [];

  const bucketKey = sheetName === ALL_SHEETS_NAME ? DISCREPANCY_ALL_SHEETS_KEY : sheetName;
  const bucket = periodDiscrepancies[bucketKey];
  if (!bucket) return [];

  const notes = [...(bucket.overallNotes ?? [])];
  if (!insurerName) return notes;

  for (const note of bucket.insurerNotes?.[insurerName] ?? []) {
    if (!notes.includes(note)) {
      notes.push(note);
    }
  }
  return notes;
}

function buildInsurerPrompt({
  dashboardState,
  selectedInsurerName,
  selectedYear,
  selectedMonth,
  aggregationMode,
  periodMode,
}) {
  const periodLabel = formatSelectionMonthLabel(selectedYear, selectedMonth);
  const insurerLabel = dashboardState.isAllInsurersView ? "전체" : selectedInsurerName;
  const topRows = dashboardState.tableRows.slice(0, 10);
  const firstRow = topRows[0];
  const secondRow = topRows[1];
  const thirdRow = topRows[2];
  const topThreeShare = topRows.slice(0, 3).reduce((sum, row) => sum + row.currentMs, 0);
  const yearlyLeaders = dashboardState.tableRows
    .filter((row) => row.benchmarkMs != null)
    .sort((a, b) => (b.benchmarkMs ?? 0) - (a.benchmarkMs ?? 0))
    .slice(0, topThreeShare >= 60 ? 3 : 5);
  const yearlyStructureLines = yearlyLeaders.length
    ? yearlyLeaders.map((row) => `${row.name} ${formatPercent(row.benchmarkMs)}`).join(", ")
    : "직전 1년 기준 데이터 없음";
  const topTenLines = topRows.length
    ? topRows.map((row) =>
        `${row.rank}위 ${row.name} | 실적 ${formatPerformance(row.performance)}천원 | 점유율 ${formatPercent(row.currentMs)} | 순위변동 ${row.delta.label}`
      ).join("\n")
    : "상위 10위 데이터 없음";
  const trendLines = dashboardState.chartSeries.length
    ? dashboardState.chartSeries.map((series) => {
        const pointSummary = series.points
          .map((point) => `${periodMode === "yearly" ? point.periodKey : formatMonthLabel(point.periodKey)} ${formatPercent(point.ms)}`)
          .join(", ");
        return `- ${series.name}: ${pointSummary}`;
      }).join("\n")
    : "- 추이 데이터 없음";

  return [
    "다음 데이터를 바탕으로 보험전문지 스타일의 월간 GA 실적 점유율 기사를 한국어로 작성해줘.",
    "",
    "[목표]",
    "- 독자가 한 번에 흐름을 이해할 수 있는 간결한 기사체로 작성",
    "- 수치를 나열하는 리포트 문체가 아니라, 자연스럽게 읽히는 기사 문장으로 작성",
    "- GA별 순위 변화와 시장 흐름이 한눈에 들어오게 작성",
    "",
    "[출력 형식]",
    "- 제목 1개",
    "- 본문 5~7문단",
    "- 불릿, 번호, 표 없이 기사 본문만 출력",
    "- 기사 외 설명은 출력하지 말 것",
    "",
    "[문체]",
    "- 보험전문지 보도문 스타일",
    "- 짧고 명확한 문장 위주",
    "- 숫자는 꼭 필요한 것만 넣고 문장 속에 자연스럽게 녹여 쓸 것",
    "- 같은 표현 반복 금지",
    "- 데이터에 없는 원인·배경은 추정하지 말 것",
    "- 다만 데이터상 확인되는 흐름은 기사체로 자연스럽게 해석할 것",
    "",
    "[핵심 작성 원칙]",
    "- GA별 데이터를 기계적으로 한 줄씩 나열하지 말 것",
    "- 같은 권역의 GA들은 묶어서 흐름 중심으로 서술할 것",
    "- 독자가 숫자를 외우지 않아도 판세를 이해할 수 있게 작성할 것",
    "- 중요한 GA는 길게, 나머지는 짧게 처리할 것",
    "- 급등·급락 GA는 반드시 언급할 것",
    "- 마지막 문장은 해당 월의 핵심 특징을 한 번 정리하고 끝낼 것",
    "",
    "[점유율 및 순위 해석 규칙]",
    "- 표기용 점유율은 기사 본문에서 소수점 첫째 자리까지만 표시할 수 있다",
    "- 단, 순위 판단과 해석은 반드시 원데이터 기준의 실제 점유율 값(소수점 둘째 자리 이상 포함)과 실적 금액을 함께 기준으로 할 것",
    "- 겉으로 보기에 같은 점유율로 보이더라도 순위가 다를 수 있으며, 이를 모순처럼 해석하지 말 것",
    "- 기사에서 “같은 점유율인데 더 낮은 순위를 기록했다”와 같은 표현은 사용하지 말 것",
    "- 순위 차이가 발생하면 실제 실적 금액 차이 또는 반올림 전 점유율 미세 차이에 따른 결과로 간주하고 자연스럽게 처리할 것",
    "- 순위 설명은 반드시 제공된 순위 데이터를 우선 기준으로 작성할 것",
    "- 점유율이 유사한 GA들은 ‘비슷한 점유율대에서 순위가 갈렸다’, ‘접전 양상을 보였다’ 정도로만 표현하고, 표기값만 보고 역전 이유를 단정하지 말 것",
    "",
    "[숫자 표기 규칙]",
    "- 모든 숫자는 읽기 쉽게 천 단위 콤마(,)를 넣어 표기할 것",
    "- 금액은 기사체에 맞게 ‘약 ○억 ○만원’, ‘약 ○만원’처럼 자연스럽게 변환",
    "- 점유율은 기사 표기상 소수점 첫째 자리까지 사용",
    "- 단, 해석은 내부적으로 소수점 둘째 자리 이상과 실적 금액을 고려해 작성할 것",
    "",
    "[추이 데이터 활용 규칙]",
    "- 기사 해석의 기본 기준은 전월 대비 변화로 할 것",
    "- 최근 3개월 추이는 반드시 언급할 필요는 없다",
    "- 최근 3개월 추이에서 점유율 확대·축소, 선두 변화, 상위권 재편 등 뚜렷한 흐름이 확인될 때만 제한적으로 활용할 것",
    "- 큰 변화가 없다면 최근 3개월 추이는 생략하고, 전월 대비 설명만으로 충분히 작성할 것",
    "- 3개월 추이를 언급하더라도 장황하게 나열하지 말고, 한 문장 안에서 간단히 정리할 것",
    "",
    "[제목 규칙]",
    "- 제목은 반드시 한 줄",
    "- 제목은 기사 핵심 구도가 바로 드러나게 작성",
    "- 상위 집중도가 핵심이면:",
    `  "{보험사명} {월} GA {시장구분} 실적 M/S…‘{핵심 GA1}·{핵심 GA2}·{핵심 GA3}’ 상위 3개사 점유율 {합산 점유율}%"`,
    "- 1위 GA가 핵심이면:",
    `  "{보험사명} {월} GA {시장구분} 실적 M/S…‘{1위 GA}’ 1위 유지 속, ‘{2위 GA}·{3위 GA}’ 상위권 형성"`,
    "",
    "[본문 구성]",
    "- 1문단: 전체 실적과 전월 대비 흐름을 짧게 요약하고, 1위 GA를 함께 제시",
    "- 2문단: 1위 GA의 유지·하락·확대 여부를 중심으로 판세 설명",
    "- 3문단: 2~4위권 변화를 묶어 서술하며, 새롭게 올라온 GA나 밀린 GA를 함께 설명",
    "- 4문단: 5~8위권 또는 중위권 흐름을 묶어 정리",
    "- 5문단 이후: 하위권은 압축적으로 처리",
    "- 마지막 문단: 직전 1년 기준 구조 + 해당 월 특징 한 번 정리하고 마무리",
    "",
    "[용어 규칙]",
    "- 기사 본문에서는 M/S라는 표현 대신 반드시 ‘점유율’로 표기할 것",
    "- 제목에서는 필요할 경우만 M/S를 사용할 수 있으나, 본문에서는 모두 ‘점유율’로 통일할 것",
    "",
    "[중위권 서술 규칙]",
    "- 중위권은 특이점이 없으면 별도의 전월 비교나 해석 없이 간결하게 정리할 것",
    "- 중위권 문단은 1~2문장 내에서 묶어 서술하고, 당월 점유율과 실적만 자연스럽게 제시할 것",
    "- 순위 급등·급락, 점유율 급변 등 뚜렷한 변화가 있을 때만 별도 설명을 덧붙일 것",
    "- 특이점이 없을 경우 예시처럼 간결한 기사체로 처리할 것",
    "- 예:",
    '  "중위권에서는 삼성금융파트너스가 점유율 5.2%, 약 4억 5,452만원을 기록했고, 밸류마크 4.7%, 케이지에이에셋 3.5%, 프라임에셋 3.2% 순으로 뒤를 이었다. 무지개컨설팅과 메가, 아너스금융서비스 등도 2%대 점유율로 중위권을 형성했다."',
    "",
    "[GA 서술 규칙]",
    "- GA별로 모두 같은 길이로 설명하지 말 것",
    "- 순위 급등, 급락, 점유율 변화가 큰 GA는 반드시 언급",
    "- “1위를 유지했다”, “상위권으로 올라섰다”, “중위권으로 밀렸다”, “비중을 키웠다”, “존재감이 줄었다” 같은 기사체 표현 활용",
    "- 숫자는 GA명 뒤에 바로 붙여 독자가 쉽게 이해하게 작성",
    "- 단, 표기상 동일한 점유율만 보고 순위의 높고 낮음을 직접 비교해 설명하지 말 것",
    "",
    "[마지막 문단 규칙]",
    "- 마지막 문단은 2문장 정도로 마무리",
    "- 첫 문장은 “직전 1년 기준 점유율을 보면”으로 시작하는 구조 설명 문장으로 작성",
    "- 직전 1년 기준은 상위 집중형이면 3위까지, 분산형이면 5위까지 점유율을 나열",
    "- 단순 수치 나열로 끝내지 말고 구조를 한 문장으로 정리",
    "- 마지막 문장은 해당 월의 특징을 기사체로 한 번 정리하고 끝낼 것",
    "- 과장된 전망이나 원인 추정은 금지",
    "",
    "[금지 사항]",
    "- GA별 데이터를 보고서처럼 한 줄씩 병렬 나열하지 말 것",
    "- ‘A는 몇 %, B는 몇 %, C는 몇 %’ 식의 반복형 문장 금지",
    "- 표기상 같은 점유율만 근거로 순위 역전 또는 순위 열세 원인을 단정하지 말 것",
    "- 데이터에 없는 영업 배경, 상품 전략, 조직 특성 추정 금지",
    "- 과장된 평가 표현 금지",
    "",
    "[수치 검증 규칙]",
    "- 기사 작성 전, 입력된 실적·점유율·순위 데이터가 서로 일치하는지 먼저 확인할 것",
    "- 순위는 제공된 순위 데이터를 절대 우선 기준으로 사용할 것",
    "- 기사에 사용한 금액, 점유율, 순위 변동, 합산 점유율은 입력값과 다시 대조한 뒤 작성할 것",
    "- 금액 단위 변환(천원 → 억/만원)은 반드시 재확인할 것",
    "- 상위 3개 또는 5개 합산 점유율을 기사에서 언급할 경우, 입력값이 있으면 그 값을 그대로 사용하고 별도 재계산하지 말 것",
    "- 입력값끼리 충돌하는 경우 임의 보정하지 말고, 충돌 사실을 밝히고 보수적으로 서술할 것",
    "- 수치가 불확실한 경우 해석보다 원문 수치 인용을 우선할 것",
    "- 기사 문장을 쓰기 전에 먼저 사용될 핵심 수치 목록을 내부적으로 정리하고, 그 수치만 본문에 반영할 것",
    "- 계산이 필요한 수치는 한 번 더 검산한 뒤 사용할 것",
    "- 입력 데이터에 없는 수치는 새로 계산해 단정적으로 쓰지 말 것",
    "",
    "입력값:",
    `- 기준 월: ${periodLabel}`,
    `- 보험사명: ${insurerLabel}`,
    `- 시장구분: ${dashboardState.selectedSheet?.sheetName ?? "-"}`,
    `- 당월 전체 실적: ${formatPerformance(dashboardState.totalPerformance)}천원`,
    `- 전월 전체 실적: ${dashboardState.previousTotalPerformance == null ? "비교 불가" : `${formatPerformance(dashboardState.previousTotalPerformance)}천원`}`,
    `- 상위 3개 GA 합산 점유율: ${formatPercent(topThreeShare)}`,
    `- 당월 GA별 점유율/실적/순위 변동 데이터:\n${topTenLines}`,
    `- 직전 1년 기준 GA별 점유율 데이터: ${yearlyStructureLines}`,
    `- 최근 월별 추이:\n${trendLines}`,
    `- 실적 기준: ${formatAggregationModeLabel(aggregationMode)}`,
  ].join("\n");
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
    chartColors,
    OTHER_BUCKET_NAME
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
  selectedPeriodKey,
  aggregationMode
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
  const monthlyTotalsMap = buildMonthlyTotals(insurerRecords);
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
    truncatedTotalPerformance: 0,
  };
  const previousPeriod = previousPeriodKey
    ? periodMap.get(previousPeriodKey) ?? { dimensions: new Map(), totalPerformance: 0, truncatedTotalPerformance: 0 }
    : { dimensions: new Map(), totalPerformance: 0, truncatedTotalPerformance: 0 };

  const currentRanked = [...currentPeriod.dimensions.entries()]
    .map(([name, performance]) => ({ name, performance }))
    .sort((a, b) => b.performance - a.performance);
  const allMonthKeys = [...monthlyTotalsMap.keys()];
  const rollingEndMonthKey = periodMode === "monthly"
    ? activePeriodKey
    : allMonthKeys.filter((monthKey) => monthKey.startsWith(`${activePeriodKey}-`)).at(-1) ?? "";
  const rollingEndIndex = allMonthKeys.indexOf(rollingEndMonthKey);
  const rollingMonthKeys = rollingEndIndex >= 11
    ? allMonthKeys.slice(rollingEndIndex - 11, rollingEndIndex + 1)
    : [];
  const rollingMonthKeySet = new Set(rollingMonthKeys);
  const rollingTotalPerformance = rollingMonthKeys.length === 12
    ? rollingMonthKeys.reduce((sum, monthKey) => sum + (monthlyTotalsMap.get(monthKey)?.totalPerformance ?? 0), 0)
    : 0;
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
      : rollingMonthKeys.length >= 12 && rollingTotalPerformance > 0;
    const benchmarkMs = hasBenchmarkData
      ? periodMode === "yearly"
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
        : (() => {
            const memberNames = new Set(item.memberNames ?? [item.name]);
            const rollingPerformance = insurerRecords.reduce((sum, record) => {
              if (!rollingMonthKeySet.has(record.monthKey)) return sum;
              if (!memberNames.has(record[dimensionKey])) return sum;
              return sum + record.performanceThousandKrw;
            }, 0);
            return (rollingPerformance / rollingTotalPerformance) * 100;
          })()
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
  const recent12TotalPerformance = rollingMonthKeys.length === 12
    ? rollingMonthKeys.reduce((sum, monthKey) => {
        const monthEntry = monthlyTotalsMap.get(monthKey);
        return sum + (
          aggregationMode === "truncated"
            ? (monthEntry?.truncatedTotalPerformance ?? 0)
            : (monthEntry?.totalPerformance ?? 0)
        );
      }, 0)
    : null;
  const totalPerformance = aggregationMode === "truncated"
    ? currentPeriod.truncatedTotalPerformance
    : currentPeriod.totalPerformance;
  const previousTotalPerformance = previousPeriodKey
    ? (
        aggregationMode === "truncated"
          ? previousPeriod.truncatedTotalPerformance
          : previousPeriod.totalPerformance
      )
    : null;

  return {
    isAllInsurersView,
    selectedSheet,
    isProductSheet,
    dimensionLabel,
    periods,
    activePeriodKey,
    recentPeriods,
    totalPerformance,
    previousTotalPerformance,
    topBenchmarkMs,
    recent12TotalPerformance,
    recent12RangeLabel: rollingMonthKeys.length === 12
      ? formatPeriodRangeLabel(rollingMonthKeys[0], rollingMonthKeys[rollingMonthKeys.length - 1])
      : "-",
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
    benchmarkLabel: periodMode === "yearly" ? "전년 MS(%)" : "최근 12개월 MS(%)",
    benchmarkHeaderLabel: periodMode === "yearly" ? "전년 MS(%)" : "최근 12개월\nMS(%)",
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
  const [aggregationMode, setAggregationMode] = useState("truncated");
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
  const [copyFeedback, setCopyFeedback] = useState("");
  const [copyStatus, setCopyStatus] = useState("idle");
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

  useEffect(() => {
    if (copyStatus === "idle") return undefined;

    const timer = window.setTimeout(() => {
      setCopyStatus("idle");
      setCopyFeedback("");
    }, 2200);

    return () => window.clearTimeout(timer);
  }, [copyStatus]);

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
  const insurerCountBaseRecords = dashboardData
    ? dashboardData.records.filter((record) => {
        const matchesPeriod = periodMode === "yearly"
          ? String(record.year) === selectedYear
          : record.monthKey === selectedPeriodKey;
        if (!matchesPeriod) return false;
        if (record.sheetName !== selectedSheetName) return false;
        return true;
      })
    : [];
  const insurerOptionCount = new Set(insurerCountBaseRecords.map((record) => record.insurerName)).size;
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
        selectedPeriodKey,
        aggregationMode
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
  const promptSummaryLabel = `${selectedYear}년 ${selectedMonth === "all" ? "전체" : `${Number(selectedMonth)}월`} ${dashboardState.summaryName} ${dashboardState.selectedSheet?.sheetName ?? selectedSheetName} 기준 보험사별 분석 프롬프트입니다.`;
  const discrepancyNotes = getDiscrepancyNotes(
    dashboardData.discrepancies,
    periodMode,
    dashboardState.activePeriodKey,
    dashboardState.selectedSheet?.sheetName ?? selectedSheetName,
    dashboardState.isAllInsurersView ? null : dashboardState.summaryName
  );
  const generatedPrompt = buildInsurerPrompt({
    dashboardState,
    selectedInsurerName,
    selectedYear,
    selectedMonth,
    aggregationMode,
    periodMode,
  });

  function selectInsurer(option) {
    setSelectedInsurerName(option.insurerName);
    setInsurerSearchText(option.label);
    setHoveredGAName("");
    setIsInsurerSelectorOpen(false);
    setCopyFeedback("");
    setCopyStatus("idle");
  }

  async function handleCopyPrompt() {
    try {
      await navigator.clipboard.writeText(generatedPrompt);
      setCopyFeedback("프롬프트를 복사했습니다.");
      setCopyStatus("success");
    } catch {
      setCopyFeedback("자동 복사에 실패했습니다. 아래 텍스트를 직접 복사해주세요.");
      setCopyStatus("error");
    }
  }

  return (
    <div className="space-y-6">
      <section className="overflow-visible rounded-[2rem] border border-slate-200 bg-[radial-gradient(circle_at_top_left,_#fff7ed,_#ffffff_55%),linear-gradient(135deg,#f8fafc,#ffffff)] p-6 shadow-sm">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl flex-1 xl:flex xl:min-h-[21.5rem] xl:flex-col xl:justify-between">
            <div className="-mt-4 sm:-mt-5 xl:-mt-6">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-600">
                INSURER PERFORMANCE
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                보험사 상세 분석
              </h1>
              <p className="mt-3 max-w-2xl text-xs leading-6 text-slate-500 sm:text-sm">
                * 본 자료는 보험저널에서 GA별로 취재, 집계된 데이터입니다.
              </p>
            </div>

            <div className="mt-6 grid gap-3 lg:grid-cols-2 xl:mt-4">
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
                <p className="mt-1 text-xs text-slate-400">단위: 천원</p>
              </div>
              <div className="rounded-[1.5rem] bg-white/90 px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  최근 12개월 누적 실적
                </p>
                <p className="mt-2 text-xl font-semibold text-slate-900">
                  {dashboardState.recent12TotalPerformance == null
                    ? "-"
                    : formatPerformance(dashboardState.recent12TotalPerformance)}
                </p>
                <p className="mt-1 text-xs text-slate-400">기준: {dashboardState.recent12RangeLabel}</p>
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
                            onClick={() => {
                              setSelectedYear(year);
                              setCopyFeedback("");
                              setCopyStatus("idle");
                            }}
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
                            onClick={() => {
                              setSelectedMonth(month);
                              setCopyFeedback("");
                              setCopyStatus("idle");
                            }}
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
                  보험사 선택 ({insurerOptionCount})
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
                            onClick={() => {
                              setSelectedSheetName(sheet.sheetName);
                              setCopyFeedback("");
                              setCopyStatus("idle");
                            }}
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
              <div className="rounded-2xl border border-slate-200 bg-white/85 px-3 py-2.5 sm:col-span-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  합산 방법
                </span>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  {[
                    { value: "decimal", label: "행별 소수점 포함" },
                    { value: "truncated", label: "행별 소수점 제외" },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setAggregationMode(option.value);
                        setCopyFeedback("");
                        setCopyStatus("idle");
                      }}
                      className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                        aggregationMode === option.value
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="relative mt-6 rounded-[1.5rem] bg-white/90 px-5 py-5">
          {copyStatus !== "idle" ? (
            <div className="pointer-events-none absolute right-5 top-5 z-10">
              <div
                className={`rounded-full px-3 py-1.5 text-xs font-semibold shadow-lg transition ${
                  copyStatus === "success"
                    ? "bg-slate-900 text-white"
                    : "bg-rose-600 text-white"
                }`}
              >
                {copyStatus === "success" ? "복사 완료" : "복사 실패"}
              </div>
            </div>
          ) : null}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">기사 프롬프트 생성</p>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                {promptSummaryLabel}
              </p>
            </div>
            <button
              type="button"
              onClick={handleCopyPrompt}
              className="inline-flex shrink-0 items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
            >
              복사하기
            </button>
          </div>
          <textarea
            readOnly
            value={generatedPrompt}
            className="mt-4 min-h-[15rem] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700 outline-none"
          />
          <p className="mt-2 text-xs text-slate-400">
            {copyStatus === "error"
              ? copyFeedback
              : "필터를 바꾸면 프롬프트도 자동으로 갱신됩니다."}
          </p>
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
                  <th className="px-3 py-2 whitespace-nowrap">{dashboardState.deltaLabel}</th>
                  <th className="px-3 py-2">{dashboardState.dimensionLabel}</th>
                  <th className="px-3 py-2 text-right">실적(천원)</th>
                  <th className="px-3 py-2 text-right">{periodMode === "yearly" ? "당해 MS" : "당월 MS"}</th>
                  <th className="whitespace-pre-line px-3 py-2 text-right leading-4">{dashboardState.benchmarkHeaderLabel}</th>
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
                      <td className="whitespace-nowrap px-3 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${row.delta.tone}`}>
                          {row.delta.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-semibold text-slate-900">
                        {row.name}
                      </td>
                      <td className="px-3 py-3 text-right font-medium text-slate-700">{formatPerformance(row.performance)}</td>
                      <td className="px-3 py-3 text-right font-medium text-slate-700">{formatPercent(row.currentMs)}</td>
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

          <div className="mt-4 rounded-2xl bg-slate-50/70 px-4 py-3 text-xs leading-5 text-slate-500">
            <ul className="list-disc space-y-1 pl-5">
              <li>MS(%): 선택한 기간의 전체 실적 대비 해당 대상이 차지하는 비중</li>
              <li>{dashboardState.deltaLabel}: 직전 기간과 비교한 순위 변동</li>
              <li>{dashboardState.benchmarkLabel}: 최근 12개월 동안의 해당 대상 실적 합계를 전체 실적 합계로 나누어 계산한 점유율</li>
              <li>Gap: 현재 MS와 최근 12개월 MS의 차이(%p)</li>
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

      {discrepancyNotes.length ? (
        <section className="rounded-[2rem] border border-amber-200 bg-amber-50/70 p-5 shadow-sm">
          <div className="border-b border-amber-200 pb-3">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-700">Source Check</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-900">원본 대비 차이 안내</h2>
          </div>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-700">
            {discrepancyNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
