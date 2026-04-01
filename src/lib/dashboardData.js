export async function fetchDashboardIndex() {
  const response = await fetch("/data/index.json");
  if (!response.ok) {
    throw new Error("대시보드 인덱스 데이터를 불러오지 못했습니다.");
  }

  return response.json();
}

export async function fetchDashboardYearRecords(year) {
  const response = await fetch(`/data/records/${year}.json`);
  if (!response.ok) {
    throw new Error(`${year}년 대시보드 데이터를 불러오지 못했습니다.`);
  }

  const payload = await response.json();
  return payload.records ?? [];
}

export function getRequiredYears(indexData, selectedYear) {
  if (!indexData || !selectedYear) return [];

  const availableYears = new Set((indexData.availableYears ?? []).map((year) => String(year)));
  const currentYear = String(selectedYear);
  const previousYear = String(Number(selectedYear) - 1);

  return [previousYear, currentYear].filter((year, index, years) =>
    availableYears.has(year) && years.indexOf(year) === index
  );
}

export function buildDashboardData(indexData, yearRecordsMap) {
  if (!indexData) return null;

  const sortedYears = Object.keys(yearRecordsMap)
    .filter((year) => Array.isArray(yearRecordsMap[year]))
    .sort((a, b) => Number(a) - Number(b));

  return {
    ...indexData,
    records: sortedYears.flatMap((year) => yearRecordsMap[year]),
  };
}
