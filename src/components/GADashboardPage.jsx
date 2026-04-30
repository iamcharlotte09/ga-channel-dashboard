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
  getRankDelta,
  summarizeNames,
} from "../lib/dashboardFormatters";

const CHART_COLORS = ["#0f766e", "#ea580c", "#2563eb", "#dc2626", "#7c3aed", "#0891b2"];
const ALL_GAS_REGISTRATION_NUMBER = "__ALL__";
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

function formatRankChangeLabel(deltaLabel) {
  if (!deltaLabel || deltaLabel === "•") return "전월과 동일";
  if (deltaLabel === "*") return "전월 비교 불가";
  if (deltaLabel.startsWith("▲")) return `전월 대비 ${deltaLabel.slice(1)}계단 상승`;
  if (deltaLabel.startsWith("▼")) return `전월 대비 ${deltaLabel.slice(1)}계단 하락`;
  return deltaLabel;
}

function formatSignedPercentPoint(value) {
  if (value == null) return "-";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%p`;
}

function formatChartLabel(name) {
  if (!name) return "";
  return name.length > 4 ? `${name.slice(0, 4)}..` : name;
}

function formatChangePercent(currentValue, previousValue) {
  if (!previousValue) return "-";
  const change = ((currentValue - previousValue) / previousValue) * 100;
  return `${change > 0 ? "+" : ""}${change.toFixed(1)}%`;
}

function buildHeadlineGuide(topRows) {
  const [firstRow, secondRow, thirdRow, fourthRow] = topRows;
  if (!firstRow) return "- 제목 생성용 데이터 없음";

  const biggestRiseRow = topRows
    .filter((row) => row.delta.label.startsWith("▲"))
    .sort((a, b) => Number(b.delta.label.slice(1)) - Number(a.delta.label.slice(1)))[0];

  const leaderPhrase = firstRow.currentMs >= 50
    ? `${firstRow.name} ${formatPercent(firstRow.currentMs)} 독주`
    : firstRow.delta.label === "•"
      ? `${firstRow.name} 선두 유지`
      : `${firstRow.name} ${formatPercent(firstRow.currentMs)} 1위`;

  let competitionPhrase = "";
  if (biggestRiseRow && biggestRiseRow.rank <= 5 && biggestRiseRow.name !== firstRow.name) {
    competitionPhrase = `${biggestRiseRow.name} ${biggestRiseRow.rank}위 급부상`;
  } else if (secondRow && thirdRow && fourthRow) {
    competitionPhrase = `${secondRow.name}·${thirdRow.name}·${fourthRow.name} 상위권 형성`;
  } else if (secondRow && thirdRow) {
    competitionPhrase = `${secondRow.name}·${thirdRow.name} 뒤이어`;
  } else if (secondRow) {
    competitionPhrase = `${secondRow.name} 뒤이어`;
  } else {
    competitionPhrase = "상위권 구도 형성";
  }

  return `- 제목 참고: {GA명} {기준 월} 생보사 실적 M/S… ${leaderPhrase}, ${competitionPhrase}`;
}

function buildTopFiveShareLine(topRows) {
  const topFiveShare = topRows.slice(0, 5).reduce((sum, row) => sum + row.currentMs, 0);
  return formatPercent(topFiveShare);
}

function getDiscrepancyNotes(discrepancies, periodMode, periodKey, sheetName, gaName) {
  const periodDiscrepancies = discrepancies?.[periodMode === "yearly" ? "yearly" : "monthly"]?.[periodKey];
  if (!periodDiscrepancies) return [];

  const bucketKey = sheetName === ALL_SHEETS_NAME ? DISCREPANCY_ALL_SHEETS_KEY : sheetName;
  const bucket = periodDiscrepancies[bucketKey];
  if (!bucket) return [];

  const notes = [...(bucket.overallNotes ?? [])];
  if (!gaName) return notes;

  for (const note of bucket.gaNotes?.[gaName] ?? []) {
    if (!notes.includes(note)) {
      notes.push(note);
    }
  }
  return notes;
}

function buildDashboardPrompt({
  dashboardState,
  selectedGA,
  selectedYear,
  selectedMonth,
  selectedSheetName,
  aggregationMode,
  periodMode,
}) {
  const periodLabel = formatSelectionMonthLabel(selectedYear, selectedMonth);
  const gaLabel = selectedGA?.gaName ?? dashboardState.gaMeta?.gaName ?? "전체";
  const topRows = dashboardState.tableRows.slice(0, 20);
  const topTenRows = dashboardState.tableRows.slice(0, 10);
  const rankingLines = topRows.length
    ? topRows.map((row) => {
        const benchmarkText = row.benchmarkMs == null ? "-" : formatPercent(row.benchmarkMs);
        const gapText = row.gap == null ? "-" : `${row.gap > 0 ? "+" : ""}${row.gap.toFixed(1)}%p`;
        return `${row.rank}위 ${row.name}: 실적 ${formatPerformance(row.performance)}천원, 현재 MS ${formatPercent(row.currentMs)}, 기준 MS ${benchmarkText}, Gap ${gapText}, ${formatRankChangeLabel(row.delta.label)}`;
      }).join("\n")
    : "순위 데이터 없음";
  const topTenLines = topTenRows.length
    ? topTenRows.map((row) => {
        const benchmarkText = row.benchmarkMs == null ? "-" : formatPercent(row.benchmarkMs);
        return `${row.rank}위 ${row.name} | 실적 ${formatPerformance(row.performance)}천원 | 당월 MS ${formatPercent(row.currentMs)} | 최근 12개월 MS ${benchmarkText} | 순위변동 ${formatRankChangeLabel(row.delta.label)}`;
      }).join("\n")
    : "상위 10위 데이터 없음";
  const topThreeShare = dashboardState.tableRows
    .slice(0, 3)
    .reduce((sum, row) => sum + row.currentMs, 0);
  const yearlyLeaders = dashboardState.tableRows
    .filter((row) => row.benchmarkMs != null)
    .sort((a, b) => (b.benchmarkMs ?? 0) - (a.benchmarkMs ?? 0))
    .slice(0, 5);
  const yearlyLeaderLines = yearlyLeaders.length
    ? yearlyLeaders.map((row, index) => `${index + 1}. ${row.name} ${formatPercent(row.benchmarkMs)}`).join("\n")
    : "최근 12개월 기준 데이터 없음";
  const trendLines = dashboardState.chartSeries.length
    ? dashboardState.chartSeries.map((series) => {
        const pointSummary = series.points
          .map((point) => `${periodMode === "yearly" ? point.periodKey : formatMonthLabel(point.periodKey)} ${formatPercent(point.ms)}`)
          .join(", ");
        return `- ${series.name}: ${pointSummary}`;
      }).join("\n")
    : "- 추이 데이터 없음";
  const totalFlowLines = [
    `- 당월 실적: ${formatPerformance(dashboardState.totalPerformance)}천원`,
    dashboardState.previousTotalPerformance == null
      ? "- 전월 실적: 비교 불가"
      : `- 전월 실적: ${formatPerformance(dashboardState.previousTotalPerformance)}천원`,
    dashboardState.previousTotalPerformance == null
      ? "- 전월 대비 증감률: 비교 불가"
      : `- 전월 대비 증감률: ${formatChangePercent(dashboardState.totalPerformance, dashboardState.previousTotalPerformance)}`,
    `- 최근 12개월 누적 실적: ${dashboardState.recent12TotalPerformance == null ? "-" : `${formatPerformance(dashboardState.recent12TotalPerformance)}천원`} (${dashboardState.recent12RangeLabel})`,
  ].join("\n");
  const pieLines = dashboardState.pieSlices.length
    ? dashboardState.pieSlices
        .map((slice) => `- ${slice.name}: 비중 ${formatPercent(slice.share)}, 실적 ${formatPerformance(slice.value)}천원`)
        .join("\n")
    : "- 상품군 비중 데이터 없음";
  const marketLabel = dashboardState.dimensionLabel === "보험사" ? "생보사 실적" : `${selectedSheetName} GA별`;
  const firstRow = topRows[0];
  const secondRow = topRows[1];
  const thirdRow = topRows[2];
  const topFiveShare = buildTopFiveShareLine(topRows);
  const isConcentratedMarket = topThreeShare >= 60;
  const yearlyStructureLines = yearlyLeaders.length
    ? yearlyLeaders
        .slice(0, isConcentratedMarket ? 3 : 5)
        .map((row) => `${row.name} ${formatPercent(row.benchmarkMs)}`)
        .join(", ")
    : "최근 12개월 기준 데이터 없음";
  const marketTopTenLines = topTenRows.length
    ? topTenRows.map((row) =>
        `${row.rank}위 ${row.name} | 실적 ${formatPerformance(row.performance)}천원 | 순위변동 ${formatRankChangeLabel(row.delta.label)} | 점유율 ${formatPercent(row.currentMs)}`
      ).join("\n")
    : "상위 10위 데이터 없음";

  if (dashboardState.isAllGAView) {
    return [
      "다음 데이터를 바탕으로 보험전문지 스타일의 월간 100대 GA 랭킹 기사를 한국어로 작성해줘.",
      "",
      "[목표]",
      "- 전체 GA 시장 랭킹과 전월 대비 판도 변화를 기사체로 정리",
      "- 개별 GA 보험사 점유율 기사가 아니라, 100대 GA 실적 순위 기사로 작성",
      "- 독자가 상위권 경쟁 구도와 중상위권 변화를 한 번에 이해할 수 있게 작성",
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
      "- GA를 기계적으로 한 줄씩 나열하지 말 것",
      "- 1~5위는 상대적으로 자세히, 그 이하는 흐름 중심으로 압축 정리",
      "- 급등·급락 GA는 반드시 언급",
      "- 전월 대비 증가폭이 큰 GA, 순위가 크게 오른 GA, 반대로 밀린 GA를 우선 서술",
      "- 마지막 문장은 해당 월 100대 GA 시장 특징을 한 번 정리하고 끝낼 것",
      "",
      "[제목 규칙]",
      "- 제목은 반드시 한 줄",
      "- 제목은 100대 GA 랭킹 기사처럼 작성",
      "- 예시 스타일만 참고하고 그대로 복사하지 말 것",
      '- 예: "{월} 생보실적 100대 GA…{1위 GA} 1위, {상승 GA1}ㆍ{상승 GA2} 상승폭 커"',
      "",
      "[본문 구성]",
      "- 1문단: 해당 월 100대 GA 실적 집계 결과와 1위 GA, 전월 대비 전체 흐름 요약",
      "- 2문단: 1위와 2위 GA를 중심으로 상위권 경쟁 설명",
      "- 3문단: 3~5위권 흐름과 상승·하락 폭이 큰 GA 설명",
      "- 4문단: 6~10위권 흐름과 눈에 띄는 순위 변동 설명",
      "- 5문단 이후: 밀려난 GA 또는 급부상 GA를 압축적으로 정리",
      "- 마지막 문단: 해당 월 100대 GA 시장의 핵심 변화와 판도 재편 여부를 한 문장으로 정리",
      "",
      "[수치 검증 규칙]",
      "- 기사 작성 전, 입력된 실적·점유율·순위 데이터가 서로 일치하는지 먼저 확인할 것",
      "- 순위는 제공된 순위 데이터를 절대 우선 기준으로 사용할 것",
      "- 기사에 사용한 금액, 점유율, 순위 변동, 합산 점유율은 입력값과 다시 대조한 뒤 작성할 것",
      "- 금액 단위 변환(천원 → 억/만원)은 반드시 재확인할 것",
      "- 상위 3개 또는 5개 합산 점유율을 기사에서 언급할 경우, 입력값이 있으면 그 값을 그대로 사용하고 별도 재계산하지 말 것",
      "- 입력값끼리 충돌하는 경우 임의 보정하지 말고, 충돌 사실을 밝히고 보수적으로 서술할 것",
      "- 수치가 불확실한 경우 해석보다 원문 수치 인용을 우선할 것",
      "",
      "입력값:",
      `- 기준 월: ${periodLabel}`,
      `- 시장 구분: ${marketLabel} M/S`,
      `- 실적 기준: ${formatAggregationModeLabel(aggregationMode)}`,
      `- 당월 전체 실적: ${formatPerformance(dashboardState.totalPerformance)}천원`,
      `- 전월 전체 실적: ${dashboardState.previousTotalPerformance == null ? "비교 불가" : `${formatPerformance(dashboardState.previousTotalPerformance)}천원`}`,
      `- 상위 3개 GA 합산 점유율: ${formatPercent(topThreeShare)}`,
      `- 상위 5개 GA 합산 점유율: ${topFiveShare}`,
      `- 당월 100대 GA 순위 데이터:\n${marketTopTenLines}`,
      `- 최근 추이:\n${trendLines}`,
    ].join("\n");
  }

  return [
    "다음 데이터를 바탕으로 보험전문지 스타일의 월간 보험사 M/S 기사를 한국어로 작성해줘.",
    "",
    "[목표]",
    "- 독자가 한 번에 흐름을 이해할 수 있는 간결한 기사체로 작성",
    "- 수치를 나열하는 리포트 문체가 아니라, 자연스럽게 읽히는 기사 문장으로 작성",
    "- 회사별 순위 변화와 시장 흐름이 한눈에 들어오게 작성",
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
    "- 회사별 데이터를 기계적으로 한 줄씩 나열하지 말 것",
    "- 같은 권역의 회사들은 묶어서 흐름 중심으로 서술할 것",
    "- 독자가 숫자를 외우지 않아도 판세를 이해할 수 있게 작성할 것",
    "- 중요한 회사는 길게, 나머지는 짧게 처리할 것",
    "- 급등·급락 회사는 반드시 언급할 것",
    "- 마지막 문장은 해당 월의 핵심 특징을 한 번 정리하고 끝낼 것",
    "",
    "[M/S 및 순위 해석 규칙]",
    "- 표기용 M/S는 기사 본문에서 소수점 첫째 자리까지만 표시할 수 있다",
    "- 단, 순위 판단과 해석은 반드시 원데이터 기준의 실제 M/S 값(소수점 둘째 자리 이상 포함)과 실적 금액을 함께 기준으로 할 것",
    "- 겉으로 보기에 같은 M/S로 보이더라도 순위가 다를 수 있으며, 이를 모순처럼 해석하지 말 것",
    "- 기사에서 “같은 M/S인데 더 낮은 순위를 기록했다”와 같은 표현은 사용하지 말 것",
    "- 순위 차이가 발생하면 실제 실적 금액 차이 또는 반올림 전 M/S 미세 차이에 따른 결과로 간주하고 자연스럽게 처리할 것",
    "- 순위 설명은 반드시 제공된 순위 데이터를 우선 기준으로 작성할 것",
    "- M/S가 유사한 회사들은 ‘비슷한 점유율대에서 순위가 갈렸다’, ‘접전 양상을 보였다’ 정도로만 표현하고, 표기값만 보고 역전 이유를 단정하지 말 것",
    "",
    "[숫자 표기 규칙]",
    "- 모든 숫자는 읽기 쉽게 천 단위 콤마(,)를 넣어 표기할 것",
    "- 금액은 기사체에 맞게 ‘약 ○억 ○만원’, ‘약 ○만원’처럼 자연스럽게 변환",
    "- M/S는 기사 표기상 소수점 첫째 자리까지 사용",
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
    `  "{GA명} {월} {시장구분} 실적 M/S…'{핵심 보험사1}·{핵심 보험사2}·{핵심 보험사3}' 상위 3개사 점유율 {합산 점유율}%"`,
    "- 1위사가 핵심이면:",
    `  "{GA명}, {월} {시장구분} M/S…{1위사} {1위 점유율}% 1위, {2위사}·{3위사} 뒤이어"`,
    "",
    "[본문 구성]",
    "- 1문단: 전체 실적과 전월 대비 흐름을 짧게 요약",
    "- 2문단: 1위 보험사의 유지·하락·확대 여부를 중심으로 판세 설명",
    "- 3문단: 2~4위권 변화를 묶어 서술하며, 새롭게 올라온 회사나 밀린 회사를 함께 설명",
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
    '  "중위권에서는 IBK연금이 점유율 2.2%, 약 290만원을 기록했고, DGB생명 1.9%, 라이나생명 1.6%, 미래에셋생명 1.4% 순으로 뒤를 이었다. ABL생명과 하나생명은 각각 0.9%, 0.8%를 기록했고, NH농협생명은 0.1%에 그쳤다."',
    "",
    "[회사 서술 규칙]",
    "- 회사별로 모두 같은 길이로 설명하지 말 것",
    "- 순위 급등, 급락, 점유율 변화가 큰 회사는 반드시 언급",
    "- “기존 1위였던”, “상위권으로 올라섰다”, “중위권으로 밀렸다”, “비중을 키웠다”, “존재감이 줄었다” 같은 기사체 표현 활용",
    "- 숫자는 회사명 뒤에 바로 붙여 독자가 쉽게 이해하게 작성",
    "- 단, 표기상 동일한 M/S만 보고 순위의 높고 낮음을 직접 비교해 설명하지 말 것",
    "",
    "[마지막 문단 규칙]",
    "- 마지막 문단은 2문장 정도로 마무리",
    "- 첫 문장은 직전 1년 기준 구조 설명",
    "- 직전 1년 기준은 상위 집중형이면 3위까지, 분산형이면 5위까지 M/S를 나열",
    "- 단순 수치 나열로 끝내지 말고 구조를 한 문장으로 정리",
    "- 마지막 문장은 해당 월의 특징을 기사체로 한 번 정리하고 끝낼 것",
    "- 과장된 전망이나 원인 추정은 금지",
    "",
    "[금지 사항]",
    "- 회사별 데이터를 보고서처럼 한 줄씩 병렬 나열하지 말 것",
    "- ‘A는 몇 %, B는 몇 %, C는 몇 %’ 식의 반복형 문장 금지",
    "- 표기상 같은 M/S만 근거로 순위 역전 또는 순위 열세 원인을 단정하지 말 것",
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
    `- GA명: ${gaLabel}`,
    `- 시장 구분: ${marketLabel} M/S`,
    `- 실적 기준: ${formatAggregationModeLabel(aggregationMode)}`,
    `- 당월 전체 실적: ${formatPerformance(dashboardState.totalPerformance)}천원`,
    `- 전월 전체 실적: ${dashboardState.previousTotalPerformance == null ? "비교 불가" : `${formatPerformance(dashboardState.previousTotalPerformance)}천원`}`,
    `- 최근 12개월 누적 실적: ${dashboardState.recent12TotalPerformance == null ? "-" : `${formatPerformance(dashboardState.recent12TotalPerformance)}천원`}`,
    `- 최근 12개월 기준 보험사별 M/S 데이터: ${yearlyStructureLines}`,
    `- 당월 보험사별 순위 데이터:\n${topTenLines}`,
    `- 최근 추이:\n${trendLines}`,
  ].join("\n");
}

function buildProductMixSlices(records, activePeriodKey, periodMode, filters, chartColors, aggregationMode) {
  const insurerNames = filters?.insurerNames ?? [];
  const gaNames = filters?.gaNames ?? [];
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
      const key = record.productName || "기타";
      const value = aggregationMode === "truncated"
        ? Math.trunc(record.performanceThousandKrw)
        : record.performanceThousandKrw;
      grouped.set(key, (grouped.get(key) ?? 0) + value);
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

function buildDashboardState(
  dashboardData,
  registrationNumber,
  selectedSheetName,
  periodMode,
  selectedPeriodKey,
  aggregationMode
) {
  const isAllGAView = registrationNumber === ALL_GAS_REGISTRATION_NUMBER;
  const isAllSheetsView = selectedSheetName === ALL_SHEETS_NAME;
  const gaMeta = isAllGAView
    ? {
        registrationNumber: ALL_GAS_REGISTRATION_NUMBER,
        gaName: "전체",
      }
    : dashboardData.gas.find((item) => item.registrationNumber === registrationNumber);
  const gaRecords = isAllGAView
    ? dashboardData.records
    : dashboardData.records.filter((item) => item.registrationNumber === registrationNumber);
  const selectedSheet = isAllSheetsView
    ? { sheetName: ALL_SHEETS_NAME, hasProductTypes: true }
    : dashboardData.sheets.find((item) => item.sheetName === selectedSheetName) ?? dashboardData.sheets[0];
  const sheetRecords = isAllSheetsView
    ? gaRecords
    : gaRecords.filter((item) => item.sheetName === selectedSheet.sheetName);
  const allSheetRecords = isAllSheetsView
    ? dashboardData.records.filter((record) => record.productName)
    : sheetRecords;
  const isProductSheet = isAllSheetsView || Boolean(selectedSheet?.hasProductTypes);
  const dimensionKey = isAllGAView ? "gaName" : "insurerName";
  const dimensionLabel = isAllGAView ? "GA" : "보험사";
  const availableYears = [...new Set(gaRecords.map((item) => item.year))].sort();
  const periodMap = buildPeriodMap(sheetRecords, periodMode, dimensionKey);
  const monthlyTotalsMap = buildMonthlyTotals(sheetRecords);
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
    truncatedDimensions: new Map(),
    totalPerformance: 0,
    truncatedTotalPerformance: 0,
  };
  const previousPeriod = previousPeriodKey
    ? periodMap.get(previousPeriodKey) ?? {
        dimensions: new Map(),
        truncatedDimensions: new Map(),
        totalPerformance: 0,
        truncatedTotalPerformance: 0,
      }
    : {
        dimensions: new Map(),
        truncatedDimensions: new Map(),
        totalPerformance: 0,
        truncatedTotalPerformance: 0,
      };

  const currentDimensionMap = aggregationMode === "truncated"
    ? currentPeriod.truncatedDimensions
    : currentPeriod.dimensions;
  const previousDimensionMap = aggregationMode === "truncated"
    ? previousPeriod.truncatedDimensions
    : previousPeriod.dimensions;
  const selectedCurrentTotalPerformance = aggregationMode === "truncated"
    ? currentPeriod.truncatedTotalPerformance
    : currentPeriod.totalPerformance;
  const selectedPreviousTotalPerformance = aggregationMode === "truncated"
    ? previousPeriod.truncatedTotalPerformance
    : previousPeriod.totalPerformance;

  const currentRanked = [...currentDimensionMap.entries()]
    .map(([name, performance]) => ({ name, performance }))
    .sort((a, b) => b.performance - a.performance);

  const allMonthKeys = dashboardData?.availableMonths ?? [...monthlyTotalsMap.keys()];
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
    [...previousDimensionMap.entries()]
      .map(([name, performance]) => ({ name, performance }))
      .sort((a, b) => b.performance - a.performance)
      .map((item, index) => [item.name, index + 1])
  );

  const visibleRanked = isAllGAView
    ? currentRanked.slice(0, OVERALL_TABLE_ROW_LIMIT)
    : currentRanked.slice(0, DETAIL_TABLE_ROW_LIMIT);
  const otherRanked = isAllGAView ? [] : currentRanked.slice(DETAIL_TABLE_ROW_LIMIT);
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
    const currentMs = selectedCurrentTotalPerformance > 0
      ? (item.performance / selectedCurrentTotalPerformance) * 100
      : 0;

    const hasBenchmarkData = periodMode === "yearly"
      ? availableYears.length >= 2 && priorPeriods.length >= 1
      : rollingMonthKeys.length >= 12 && rollingTotalPerformance > 0;

    const benchmarkMs = hasBenchmarkData
      ? periodMode === "yearly"
        ? priorPeriods.reduce((sum, periodKey) => {
            const periodEntry = periodMap.get(periodKey);
            const periodTotal = aggregationMode === "truncated"
              ? (periodEntry?.truncatedTotalPerformance ?? 0)
              : (periodEntry?.totalPerformance ?? 0);
            const periodPerformance = item.isOtherBucket
              ? (item.memberNames ?? []).reduce(
                  (memberSum, memberName) => memberSum + (
                    aggregationMode === "truncated"
                      ? (periodEntry?.truncatedDimensions.get(memberName) ?? 0)
                      : (periodEntry?.dimensions.get(memberName) ?? 0)
                  ),
                  0
                )
              : (
                  aggregationMode === "truncated"
                    ? (periodEntry?.truncatedDimensions.get(item.name) ?? 0)
                    : (periodEntry?.dimensions.get(item.name) ?? 0)
                );
            if (!periodTotal) return sum;
            return sum + (periodPerformance / periodTotal) * 100;
          }, 0) / priorPeriods.length
        : (() => {
            const memberNames = new Set(item.memberNames ?? [item.name]);
            const rollingPerformance = sheetRecords.reduce((sum, record) => {
              if (!rollingMonthKeySet.has(record.monthKey)) return sum;
              if (!memberNames.has(record[dimensionKey])) return sum;
              return sum + (
                aggregationMode === "truncated"
                  ? Math.trunc(record.performanceThousandKrw)
                  : record.performanceThousandKrw
              );
            }, 0);
            const selectedRollingTotalPerformance = aggregationMode === "truncated"
              ? rollingMonthKeys.reduce(
                  (sum, monthKey) => sum + (monthlyTotalsMap.get(monthKey)?.truncatedTotalPerformance ?? 0),
                  0
                )
              : rollingTotalPerformance;
            return selectedRollingTotalPerformance > 0
              ? (rollingPerformance / selectedRollingTotalPerformance) * 100
              : 0;
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
      const periodTotal = aggregationMode === "truncated"
        ? (periodEntry?.truncatedTotalPerformance ?? 0)
        : (periodEntry?.totalPerformance ?? 0);
      const memberNames = chartRowMap.get(name)?.memberNames ?? [name];
      const performance = memberNames.reduce(
        (sum, memberName) => sum + (
          aggregationMode === "truncated"
            ? (periodEntry?.truncatedDimensions.get(memberName) ?? 0)
            : (periodEntry?.dimensions.get(memberName) ?? 0)
        ),
        0
      );
      const ms = periodTotal ? (performance / periodTotal) * 100 : 0;
      return {
        periodKey,
        ms,
      };
    }),
  }));

  const previousTotalForChange = selectedPreviousTotalPerformance;
  const msChangeRows = [...new Set([
    ...currentDimensionMap.keys(),
    ...previousDimensionMap.keys(),
  ])]
    .map((name) => {
      const currentPerformance = currentDimensionMap.get(name) ?? 0;
      const previousPerformance = previousDimensionMap.get(name) ?? 0;
      const currentMs = selectedCurrentTotalPerformance > 0
        ? (currentPerformance / selectedCurrentTotalPerformance) * 100
        : 0;
      const previousMs = previousTotalForChange > 0
        ? (previousPerformance / previousTotalForChange) * 100
        : 0;
      return {
        name,
        currentMs,
        previousMs,
        changeMs: currentMs - previousMs,
      };
    })
    .filter((row) => Math.abs(row.changeMs) > 0)
    .sort((a, b) => Math.abs(b.changeMs) - Math.abs(a.changeMs))
    .slice(0, 10);

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
  const benchmarkLabel = periodMode === "yearly" ? "전년 MS(%)" : "최근 12개월 MS(%)";
  const benchmarkHeaderLabel = periodMode === "yearly" ? "전년 MS(%)" : "최근 12개월\nMS(%)";
  const deltaLabel = periodMode === "yearly" ? "전년 대비" : "전월 대비";
  const lineChartTitle = isAllGAView
      ? periodMode === "yearly"
        ? "최근 3개년 TOP 5 GA별 MS 추이"
        : "최근 3개월 TOP 5 GA별 MS 추이"
      : periodMode === "yearly"
        ? "TOP 5 최근 3개년 MS 추이"
        : "TOP 5 최근 3개월 MS 추이";
  const pieChartTitle = isAllSheetsView
    ? "전체 상품군 비중"
    : isAllGAView
      ? "전체 GA 상품군 비중"
      : `${gaMeta?.gaName ?? "선택한 GA"} 상품군 비중`;
  const tableTitle = isAllGAView
    ? "전체 GA 순위"
    : `${gaMeta?.gaName ?? "선택한 GA"} ${selectedSheet?.sheetName ?? selectedSheetName} 판매 보험사 순위`;

  return {
    gaMeta,
    isAllGAView,
    selectedSheet,
    isProductSheet,
    dimensionLabel,
    periods,
    activePeriodKey,
    previousPeriodKey,
    previousTotalPerformance: previousPeriodKey ? selectedPreviousTotalPerformance : null,
    recentPeriods,
    topBenchmarkMs,
    recent12TotalPerformance,
    recent12RangeLabel: rollingMonthKeys.length === 12
      ? formatPeriodRangeLabel(rollingMonthKeys[0], rollingMonthKeys[rollingMonthKeys.length - 1])
      : "-",
    totalPerformance,
    tableRows,
    chartSeries,
    msChangeRows,
    pieSlices: isProductSheet
        ? buildProductMixSlices(
          allSheetRecords,
          activePeriodKey,
          periodMode,
          {},
          CHART_COLORS,
          aggregationMode
        )
      : [],
    benchmarkLabel,
    benchmarkHeaderLabel,
    deltaLabel,
    chartTitle: lineChartTitle,
    pieChartTitle,
    tableTitle,
  };
}

function DashboardChart({
  recentPeriods,
  chartSeries,
  highlightedInsurer,
  onHoverInsurer,
  onLeaveInsurer,
  chartTitle,
  periodMode,
}) {
  const width = 520;
  const height = 320;
  const padding = { top: 24, right: 86, bottom: 40, left: 44 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(
    5,
    ...chartSeries.flatMap((series) => series.points.map((point) => point.ms))
  );
  const labelPositionMap = new Map();
  let previousLabelY = -Infinity;

  [...chartSeries]
    .sort((a, b) => {
      const aLast = a.points[a.points.length - 1]?.ms ?? 0;
      const bLast = b.points[b.points.length - 1]?.ms ?? 0;
      return bLast - aLast;
    })
    .forEach((series) => {
      const lastPoint = series.points[series.points.length - 1];
      const baseY = padding.top + plotHeight - ((lastPoint?.ms ?? 0) / maxValue) * plotHeight;
      const adjustedY = Math.max(baseY, previousLabelY + 16);
      const clampedY = Math.min(adjustedY, height - padding.bottom + 2);
      labelPositionMap.set(series.name, clampedY);
      previousLabelY = clampedY;
    });

  return (
    <div className="rounded-[2rem] border border-slate-200 bg-[linear-gradient(180deg,#fff7ed_0%,#ffffff_56%)] p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="whitespace-nowrap text-lg font-semibold text-slate-900">
            {chartTitle}
          </h3>
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
          const isActive = highlightedInsurer === series.name;
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
              onMouseEnter={() => onHoverInsurer(series.name)}
              onMouseLeave={onLeaveInsurer}
            >
              <path
                d={path}
                fill="none"
                stroke={series.color}
                strokeWidth={isActive ? 4 : 2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={highlightedInsurer && !isActive ? 0.25 : 1}
              />
              {series.points.map((point, index) => {
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
                    opacity={highlightedInsurer && !isActive ? 0.25 : 1}
                  />
                );
              })}
              <text
                x={width - padding.right + 10}
                y={labelPositionMap.get(series.name) ?? padding.top}
                fontSize="14"
                fontWeight="600"
                fill={series.color}
                opacity={highlightedInsurer && !isActive ? 0.35 : 1}
              >
                {formatChartLabel(series.name)}
              </text>
            </g>
          );
        })}

      </svg>
    </div>
  );
}

function MsChangeChart({ rows, title }) {
  const maxAbsValue = Math.max(0.5, ...rows.map((row) => Math.abs(row.changeMs)));

  return (
    <div className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      </div>

      {rows.length ? (
        <div className="space-y-3">
          {rows.map((row) => {
            const width = `${(Math.abs(row.changeMs) / maxAbsValue) * 100}%`;
            const isPositive = row.changeMs > 0;
            return (
              <div key={row.name} className="grid gap-1.5">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate font-medium text-slate-900">{row.name}</span>
                  <span className={isPositive ? "font-semibold text-emerald-700" : "font-semibold text-rose-700"}>
                    {`${isPositive ? "+" : ""}${row.changeMs.toFixed(1)}%p`}
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${isPositive ? "bg-emerald-500" : "bg-rose-500"}`}
                    style={{ width }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>이전 {formatPercent(row.previousMs)}</span>
                  <span>현재 {formatPercent(row.currentMs)}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl bg-slate-50 px-4 py-6 text-sm text-slate-500">
          비교 가능한 전월 데이터가 없습니다.
        </div>
      )}
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

export default function GADashboardPage() {
  const [dashboardIndex, setDashboardIndex] = useState(null);
  const [yearRecordsMap, setYearRecordsMap] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [aggregationMode, setAggregationMode] = useState("decimal");
  const [selectedRegistrationNumber, setSelectedRegistrationNumber] = useState("");
  const [selectedSheetName, setSelectedSheetName] = useState("월초");
  const [selectedYear, setSelectedYear] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [gaSearchText, setGASearchText] = useState("");
  const [isGASelectorOpen, setIsGASelectorOpen] = useState(false);
  const [isYearSelectorOpen, setIsYearSelectorOpen] = useState(false);
  const [isMonthSelectorOpen, setIsMonthSelectorOpen] = useState(false);
  const [isSheetSelectorOpen, setIsSheetSelectorOpen] = useState(false);
  const [hoveredInsurerName, setHoveredInsurerName] = useState("");
  const [isJournalMode, setIsJournalMode] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState("");
  const [copyStatus, setCopyStatus] = useState("idle");
  const gaSelectorRef = useRef(null);
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

        const gasWithAllOption = [
          {
            registrationNumber: ALL_GAS_REGISTRATION_NUMBER,
            gaName: "전체",
          },
          ...payload.gas,
        ];

        setDashboardIndex(payload);
        const defaultRegistrationNumber = ALL_GAS_REGISTRATION_NUMBER;
        const defaultGA = gasWithAllOption.find((item) => item.registrationNumber === defaultRegistrationNumber);
        const latestMonthKey = payload.availableMonths.at(-1) ?? "";
        const [latestYear, latestMonth] = latestMonthKey.split("-");
        setSelectedRegistrationNumber(defaultRegistrationNumber);
        setSelectedSheetName(payload.sheets.find((item) => item.sheetName === "월초")?.sheetName ?? payload.sheets[0]?.sheetName ?? "");
        setSelectedYear(latestYear ?? "");
        setSelectedMonth(latestMonth ?? "");
        setGASearchText(defaultGA?.gaName ?? "");
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
      if (!gaSelectorRef.current?.contains(event.target)) {
        setIsGASelectorOpen(false);
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
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
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

  const dashboardState = dashboardData
    ? buildDashboardState(
        dashboardData,
        selectedRegistrationNumber,
        selectedSheetName,
        periodMode,
        selectedPeriodKey,
        aggregationMode
      )
    : null;

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

  const gaOptions = dashboardData
    ? [
        {
          registrationNumber: ALL_GAS_REGISTRATION_NUMBER,
          gaName: "전체",
        },
        ...dashboardData.gas,
      ]
    : [];
  const filteredGAs = gaOptions.filter((ga) => {
    const keyword = gaSearchText.trim().toLowerCase();
    if (!keyword) return true;
    return (
      ga.gaName.toLowerCase().includes(keyword) ||
      ga.registrationNumber.toLowerCase().includes(keyword)
    );
  }) ?? [];

  const selectedGA = gaOptions.find(
    (item) => item.registrationNumber === selectedRegistrationNumber
  );
  const availableSheets = dashboardData
    ? [
        { sheetName: ALL_SHEETS_NAME, hasProductTypes: true },
        ...dashboardData.sheets.filter((sheet) =>
          selectedRegistrationNumber === ALL_GAS_REGISTRATION_NUMBER ||
          dashboardData.records.some(
            (record) =>
              record.registrationNumber === selectedRegistrationNumber &&
              record.sheetName === sheet.sheetName
          )
        ),
      ]
    : [];
  const gaCountBaseRecords = dashboardData
    ? dashboardData.records.filter((record) => {
        const matchesPeriod = periodMode === "yearly"
          ? String(record.year) === selectedYear
          : record.monthKey === selectedPeriodKey;
        if (!matchesPeriod) return false;
        if (selectedSheetName !== ALL_SHEETS_NAME && record.sheetName !== selectedSheetName) return false;
        return true;
      })
    : [];
  const gaOptionCount = new Set(gaCountBaseRecords.map((record) => record.registrationNumber)).size;

  useEffect(() => {
    if (!availableSheets.length) return;
    if (availableSheets.some((sheet) => sheet.sheetName === selectedSheetName)) return;

    setSelectedSheetName(availableSheets[0].sheetName);
    setHoveredInsurerName("");
  }, [availableSheets, selectedSheetName]);

  useEffect(() => {
    if (copyStatus === "idle") return undefined;

    const timer = window.setTimeout(() => {
      setCopyStatus("idle");
      setCopyFeedback("");
    }, 2200);

    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  if (isLoading) {
    return (
      <div className="rounded-[2rem] border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500 shadow-sm">
        월초 대시보드 데이터를 불러오는 중입니다.
      </div>
    );
  }

  if (loadError || !dashboardData) {
    return (
      <div className="rounded-[2rem] border border-rose-200 bg-rose-50 px-6 py-12 text-center text-sm font-semibold text-rose-700 shadow-sm">
        {loadError || "대시보드 데이터를 불러오지 못했습니다."}
      </div>
    );
  }

  if (!dashboardState) {
    return (
      <div className="rounded-[2rem] border border-rose-200 bg-rose-50 px-6 py-12 text-center text-sm font-semibold text-rose-700 shadow-sm">
        대시보드 상태를 계산하지 못했습니다.
      </div>
    );
  }

  const chartSeriesNames = new Set(dashboardState.chartSeries.map((series) => series.name));
  const highlightedInsurerCandidate = hoveredInsurerName;
  const highlightedInsurer = chartSeriesNames.has(highlightedInsurerCandidate)
    ? highlightedInsurerCandidate
    : "";
  const promptSummaryLabel = `${selectedYear}년 ${selectedMonth === "all" ? "전체" : `${Number(selectedMonth)}월`} ${dashboardState.gaMeta?.gaName ?? "-"} ${dashboardState.selectedSheet?.sheetName ?? selectedSheetName} 기준 GA별 분석 프롬프트입니다.`;
  const discrepancyNotes = getDiscrepancyNotes(
    dashboardData.discrepancies,
    periodMode,
    dashboardState.activePeriodKey,
    dashboardState.selectedSheet?.sheetName ?? selectedSheetName,
    dashboardState.isAllGAView ? null : dashboardState.gaMeta?.gaName
  );
  const generatedPrompt = buildDashboardPrompt({
    dashboardState,
    selectedGA,
    selectedYear,
    selectedMonth,
    selectedSheetName: dashboardState.selectedSheet?.sheetName ?? selectedSheetName,
    aggregationMode,
    periodMode,
  });

  function selectGA(ga) {
    setSelectedRegistrationNumber(ga.registrationNumber);
    setGASearchText(ga.gaName);
    setHoveredInsurerName("");
    setIsGASelectorOpen(false);
    setCopyFeedback("");
    setCopyStatus("idle");
  }

  function selectSheet(sheetName) {
    setSelectedSheetName(sheetName);
    setHoveredInsurerName("");
    setIsSheetSelectorOpen(false);
    setCopyFeedback("");
    setCopyStatus("idle");
  }

  function selectYear(year) {
    setSelectedYear(year);
    setHoveredInsurerName("");
    setIsYearSelectorOpen(false);
    setCopyFeedback("");
    setCopyStatus("idle");
  }

  function selectMonth(month) {
    setSelectedMonth(month);
    setHoveredInsurerName("");
    setIsMonthSelectorOpen(false);
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
      <section className="overflow-visible rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-5">
          <div className="max-w-3xl">
            <div className="pt-1 sm:pt-1.5">
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                GA 상세 분석
              </h1>
              <p className="mt-3 max-w-2xl text-xs leading-6 text-slate-500 sm:text-sm">
                * 본 자료는 보
                <button
                  type="button"
                  onClick={() => setIsJournalMode((current) => !current)}
                  className="m-0 inline appearance-none border-0 bg-transparent p-0 align-baseline font-inherit text-slate-500 no-underline outline-none"
                >
                  험
                </button>
                저널에서 GA별로 취재, 집계된 데이터입니다.
              </p>
            </div>

          </div>
          <div className="w-full rounded-[2.25rem] border border-slate-200 bg-white p-2 shadow-[0_16px_34px_-22px_rgba(15,23,42,0.2)]">
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[0.8fr_0.8fr_1.8fr_1fr_1.6fr] xl:gap-0">
              <label className="rounded-[1.45rem] bg-white px-4 py-3 transition xl:rounded-none xl:border-r xl:border-slate-200">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                연 선택
              </span>
              <div ref={yearSelectorRef} className="relative mt-1.5">
                <button
                  type="button"
                  onClick={() => setIsYearSelectorOpen((current) => !current)}
                  className="flex w-full items-center justify-between bg-transparent py-0.5 text-left text-lg font-medium text-slate-900"
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
                          onClick={() => selectYear(year)}
                          className={`flex w-full items-center justify-between gap-3 px-3 py-3 text-left text-sm transition hover:bg-orange-50 ${
                            year === selectedYear ? "bg-slate-50" : ""
                          }`}
                        >
                          <span className="font-semibold text-slate-900">{year}</span>
                          {year === selectedYear ? (
                            <span className="rounded-full bg-slate-900 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white">
                              선택됨
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
              </label>

              <label className="rounded-[1.45rem] bg-white px-4 py-3 transition xl:rounded-none xl:border-r xl:border-slate-200">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                월 선택
              </span>
              <div ref={monthSelectorRef} className="relative mt-1.5">
                <button
                  type="button"
                  onClick={() => setIsMonthSelectorOpen((current) => !current)}
                  className="flex w-full items-center justify-between bg-transparent py-0.5 text-left text-lg font-medium text-slate-900"
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
                          onClick={() => selectMonth(month)}
                          className={`flex w-full items-center justify-between gap-3 px-3 py-3 text-left text-sm transition hover:bg-orange-50 ${
                            month === selectedMonth ? "bg-slate-50" : ""
                          }`}
                        >
                          <span className="font-semibold text-slate-900">
                            {month === "all" ? "전체" : Number(month)}
                          </span>
                          {month === selectedMonth ? (
                            <span className="rounded-full bg-slate-900 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white">
                              선택됨
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
              </label>

              <label className="rounded-[1.45rem] bg-white px-4 py-3 transition md:col-span-2 xl:col-span-1 xl:rounded-none xl:border-r xl:border-slate-200">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                GA 선택 ({gaOptionCount})
              </span>
              <div ref={gaSelectorRef} className="relative mt-1.5">
                <input
                  type="text"
                  value={gaSearchText}
                  onFocus={() => setIsGASelectorOpen(true)}
                  onChange={(event) => {
                    setGASearchText(event.target.value);
                    setIsGASelectorOpen(true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setIsGASelectorOpen(false);
                      setGASearchText(selectedGA?.gaName ?? "");
                    }
                    if (event.key === "Enter" && filteredGAs[0]) {
                      event.preventDefault();
                      selectGA(filteredGAs[0]);
                    }
                  }}
                  placeholder="GA명 또는 등록번호 입력"
                  className="w-full bg-transparent py-0.5 text-lg font-medium text-slate-900 outline-none ring-0 placeholder:font-medium placeholder:text-slate-400"
                />
                {isGASelectorOpen ? (
                  <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-30 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
                    {filteredGAs.length ? (
                      <div className="max-h-80 overflow-y-auto py-1">
                        {filteredGAs.map((ga) => (
                          <button
                            key={ga.registrationNumber}
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => selectGA(ga)}
                            className={`flex w-full items-center justify-between gap-3 px-3 py-3 text-left text-sm transition hover:bg-orange-50 ${
                              ga.registrationNumber === selectedRegistrationNumber ? "bg-slate-50" : ""
                            }`}
                          >
                            <span className="min-w-0">
                              <span className="block font-semibold text-slate-900">{ga.gaName}</span>
                              <span className="mt-0.5 block text-xs text-slate-500">
                                {ga.registrationNumber}
                              </span>
                            </span>
                            {ga.registrationNumber === selectedRegistrationNumber ? (
                              <span className="rounded-full bg-slate-900 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white">
                                선택됨
                              </span>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="px-3 py-4 text-sm text-slate-500">
                        검색 결과가 없습니다.
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
              </label>

              <label className="rounded-[1.45rem] bg-white px-4 py-3 transition md:col-span-1 xl:col-span-1 xl:rounded-none xl:border-r xl:border-slate-200">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                시트 선택
              </span>
              <div ref={sheetSelectorRef} className="relative mt-1.5">
                <button
                  type="button"
                  onClick={() => setIsSheetSelectorOpen((current) => !current)}
                  className="flex w-full items-center justify-between bg-transparent py-0.5 text-left text-lg font-medium text-slate-900"
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
                          onClick={() => selectSheet(sheet.sheetName)}
                          className={`flex w-full items-center justify-between gap-3 px-3 py-3 text-left text-sm transition hover:bg-orange-50 ${
                            sheet.sheetName === dashboardState.selectedSheet?.sheetName ? "bg-slate-50" : ""
                          }`}
                        >
                          <span className="font-semibold text-slate-900">{sheet.sheetName}</span>
                          {sheet.sheetName === dashboardState.selectedSheet?.sheetName ? (
                            <span className="rounded-full bg-slate-900 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white">
                              선택됨
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
              </label>

              <div className="rounded-[1.45rem] bg-white px-4 py-3 transition md:col-span-1 xl:col-span-1 xl:rounded-none">
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
                      className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${
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

      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-end justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Rank Table</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-900">
                {dashboardState.isAllGAView ? (
                  dashboardState.tableTitle
                ) : (
                  <>
                    <span className="text-slate-900">
                      {dashboardState.gaMeta?.gaName ?? "선택한 GA"} {dashboardState.selectedSheet?.sheetName ?? selectedSheetName}
                    </span>{" "}
                    <span className="text-slate-900">판매 보험사 순위</span>
                  </>
                )}
              </h2>
            </div>
            <p className="text-sm text-slate-500">
              {periodMode === "yearly"
                ? `${dashboardState.activePeriodKey} 실적 기준`
                : `${formatMonthLabel(dashboardState.activePeriodKey)} 실적 기준`}
            </p>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-[1.5rem] bg-slate-50 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">당월 실적</p>
              <p className="mt-2 text-xl font-semibold text-slate-900">
                {formatPerformance(dashboardState.totalPerformance)}
              </p>
              <p className="mt-1 text-xs text-slate-400">단위: 천원</p>
            </div>
            <div className="rounded-[1.5rem] bg-slate-50 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">최근 12개월 누적 실적</p>
              <p className="mt-2 text-xl font-semibold text-slate-900">
                {dashboardState.recent12TotalPerformance == null
                  ? "-"
                  : formatPerformance(dashboardState.recent12TotalPerformance)}
              </p>
              <p className="mt-1 text-xs text-slate-400">기준: {dashboardState.recent12RangeLabel}</p>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  <th className="px-3 py-2">순위</th>
                  <th className="whitespace-nowrap px-3 py-2">{dashboardState.deltaLabel}</th>
                  <th className="px-3 py-2">{dashboardState.dimensionLabel === "GA" ? "GA명" : dashboardState.dimensionLabel}</th>
                  <th className="px-3 py-2 text-right">실적(천원)</th>
                  <th className="px-3 py-2 text-right">{periodMode === "yearly" ? "당해 MS" : "당월 MS"}</th>
                  <th className="whitespace-pre-line px-3 py-2 text-right leading-4">{dashboardState.benchmarkHeaderLabel}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {dashboardState.tableRows.map((row) => {
                  const isHovered = hoveredInsurerName === row.name;
                  return (
                    <tr
                      key={row.name}
                      onMouseEnter={() => setHoveredInsurerName(row.name)}
                      onMouseLeave={() => setHoveredInsurerName("")}
                      className={`cursor-pointer transition ${
                        isHovered
                          ? "bg-orange-50"
                          : "bg-white"
                      }`}
                    >
                      <td className="px-3 py-3 font-semibold text-slate-900">{row.rank}</td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${row.delta.tone}`}>
                          {row.delta.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-semibold text-slate-900">
                        {row.name}
                      </td>
                      <td className="px-3 py-3 text-right font-medium text-slate-700">
                        {formatPerformance(row.performance)}
                      </td>
                      <td className="px-3 py-3 text-right font-medium text-slate-700">
                        {formatPercent(row.currentMs)}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-500">
                        {formatPercent(row.benchmarkMs)}
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
              {dashboardState.isProductSheet ? <li>우측 파이차트: 선택한 보험사 내부의 상품군 비중</li> : null}
            </ul>
          </div>
        </div>

        <div className="space-y-6">
          <DashboardChart
            recentPeriods={dashboardState.recentPeriods}
            chartSeries={dashboardState.chartSeries}
            highlightedInsurer={highlightedInsurer}
            onHoverInsurer={setHoveredInsurerName}
            onLeaveInsurer={() => setHoveredInsurerName("")}
            chartTitle={dashboardState.chartTitle}
            periodMode={periodMode}
          />
          <MsChangeChart
            rows={dashboardState.msChangeRows}
            title={periodMode === "yearly" ? "전년 대비 MS 변화 Top 10" : "전월 대비 MS 변화 Top 10"}
          />
          {dashboardState.isProductSheet ? (
            <PieChart
              title={dashboardState.pieChartTitle}
              slices={dashboardState.pieSlices}
            />
          ) : null}
        </div>
      </section>

      {isJournalMode ? (
      <section className="relative rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
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
      </section>
      ) : null}

      {discrepancyNotes.length ? (
        <section className="rounded-[2rem] border border-amber-200 bg-amber-50/70 p-5 shadow-sm">
          <div className="border-b border-amber-200 pb-3">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-700">Source Check</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-900">원본 대비 차이 안내</h2>
          </div>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-700">
            {discrepancyNotes.map((note) => (
              <li key={note} className="whitespace-pre-line">{note}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
