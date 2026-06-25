import json
from collections import defaultdict
import math

# 1. 데이터 로드
records = []
for file_name in ['2025.json', '2026.json']:
    try:
        with open(f'/Users/charlottechoi/projects/insjournal/ga_channel_dashboard/public/data/records/{file_name}', 'r') as f:
            data = json.load(f)
            records.extend(data['records'])
    except Exception as e:
        pass

for r in records:
    r['monthKey'] = f"{r['year']}-{str(r['month']).zfill(2)}"

months = sorted(list(set(r['monthKey'] for r in records)))
target_month = '2026-04'
if target_month not in months and months:
    target_month = months[-1]

month_idx = months.index(target_month)
recent_12_months = months[max(0, month_idx - 11): month_idx + 1]

# What if Top 20 is sorted by ALL sheets performance in 2026-04, but MS is calculated on '월초'?
recent_records = [r for r in records if r['monthKey'] in recent_12_months and r['sheetName'] == '월초']
# 2. B 대시보드 백트래킹 타겟
b_targets = {
    "DGB생명": {"total": 16291492, "cur": 10.8, "prev": 14.7},
    "KDB생명": {"total": 15886752, "cur": 26.4, "prev": 28.5},
    "푸본현대생명": {"total": 11912904, "cur": 7.2, "prev": 15.8},
    "라이나생명": {"total": 22683374, "cur": 26.8, "prev": 30.4},
    "DB생명": {"total": 28700983, "cur": 5.1, "prev": 10.5},
    "삼성생명": {"total": 25158319, "cur": 28.1, "prev": 30.0},
    "교보생명": {"total": 43841949, "cur": 21.1, "prev": 24.6},
    "NH농협생명": {"total": 24463041, "cur": 12.6, "prev": 23.3},
    "하나생명": {"total": 30500412, "cur": 4.9, "prev": 9.2},
    "동양생명": {"total": 26150020, "cur": 19.1, "prev": 30.3},
    "KB라이프": {"total": 56458045, "cur": 26.7, "prev": 31.6},
    "한화생명": {"total": 101458856, "cur": 15.7, "prev": 17.2},
    "신한라이프": {"total": 77608060, "cur": 29.7, "prev": 30.3},
    "메트라이프생명": {"total": 50353204, "cur": 26.8, "prev": 27.5}
}

current_records_all = [r for r in records if r['monthKey'] == target_month and r.get('productName')]
# 3. 로직 조합 테스트 함수
def get_val(r, agg_mode):
    val = r['performanceThousandKrw']
    if agg_mode == 'round': return round(val)
    if agg_mode == 'trunc': return math.trunc(val)
    return val

def analyze_insurer(insurer_name):
    ins_recent = [r for r in recent_records if r['insurerName'] == insurer_name]
    total_raw = sum(r['performanceThousandKrw'] for r in ins_recent)
def test_logic(agg_mode, sort_mode, prev_calc_mode):
    match_count = 0
    total_metrics = len(b_targets) * 3
    
    ins_current_all = [r for r in current_records_all if r['insurerName'] == insurer_name]
    curr_grouped_all = defaultdict(float)
    for r in ins_current_all:
        curr_grouped_all[r['gaName']] += r['performanceThousandKrw']
    for ins_name, targets in b_targets.items():
        ins_records = [r for r in records if r['insurerName'] == ins_name or (ins_name == '메트라이프생명' and r['insurerName'] == '메트라이프')]
        
    sorted_curr_gas_all = sorted(curr_grouped_all.items(), key=lambda x: x[1], reverse=True)
    top_20_all = set(x[0] for x in sorted_curr_gas_all[:20])
    
    other_perf = sum(r['performanceThousandKrw'] for r in ins_recent if r['gaName'] not in top_20_all)
    pct = (other_perf / total_raw) * 100 if total_raw > 0 else 0
    print(f"[{insurer_name}] Top 20 sorted by ALL sheets: Other% = {pct:.1f}%")
        # --- 1년 총합 계산 ---
        r12_records = [r for r in ins_records if r['monthKey'] in recent_12_months and r['sheetName'] == '월초']
        total_sum = sum(get_val(r, agg_mode) for r in r12_records)
        
        # --- 당월 기타(%) 계산 ---
        cur_month_records = [r for r in ins_records if r['monthKey'] == target_month]
        
        if sort_mode == '월초':
            sort_records = [r for r in cur_month_records if r['sheetName'] == '월초']
        else:
            sort_records = [r for r in cur_month_records if r.get('productName')]
            
        ga_sums_cur = defaultdict(float)
        for r in sort_records:
            ga_sums_cur[r['gaName']] += get_val(r, agg_mode)
            
        top20_gas = set([x[0] for x in sorted(ga_sums_cur.items(), key=lambda x: x[1], reverse=True)[:20]])
        
        cur_wolcho_records = [r for r in cur_month_records if r['sheetName'] == '월초']
        cur_total_wolcho = sum(get_val(r, agg_mode) for r in cur_wolcho_records)
        cur_other_wolcho = sum(get_val(r, agg_mode) for r in cur_wolcho_records if r['gaName'] not in top20_gas)
        
        cur_pct = round((cur_other_wolcho / cur_total_wolcho * 100), 1) if cur_total_wolcho > 0 else 0.0
        
        # --- 직전 1년 기타(%) 계산 ---
        if prev_calc_mode == 'fixed':
            prev_other_sum = sum(get_val(r, agg_mode) for r in r12_records if r['gaName'] not in top20_gas)
        else:
            ga_sums_12m = defaultdict(float)
            for r in r12_records:
                ga_sums_12m[r['gaName']] += get_val(r, agg_mode)
            top20_12m = set([x[0] for x in sorted(ga_sums_12m.items(), key=lambda x: x[1], reverse=True)[:20]])
            prev_other_sum = sum(get_val(r, agg_mode) for r in r12_records if r['gaName'] not in top20_12m)
            
        prev_pct = round((prev_other_sum / total_sum * 100), 1) if total_sum > 0 else 0.0
        
        if abs(total_sum - targets['total']) < 10: match_count += 1
        if abs(cur_pct - targets['cur']) <= 0.1: match_count += 1
        if abs(prev_pct - targets['prev']) <= 0.1: match_count += 1

for ins in ['삼성생명', 'NH농협생명', 'DB생명', 'KB라이프', 'IM라이프', '메트라이프생명', '신한라이프', '동양생명']:
    analyze_insurer(ins)
    return round((match_count / total_metrics) * 100, 1)

best_score = 0
best_logic = ""

for a in ['raw(소수점유지)', 'round(반올림)', 'trunc(버림)']:
    for s in ['월초(현재내방식)', '전체(B추정방식)']:
        for p in ['fixed(당월Top20유지)', 'resort(과거1년합산으로다시Top20선별)']:
            mode_a = a.split('(')[0]
            mode_s = s.split('(')[0]
            mode_p = p.split('(')[0]
            
            score = test_logic(mode_a, mode_s, mode_p)
            if score > best_score:
                best_score = score
                best_logic = f"합산방식: {a}\nTop20 기준시트: {s}\n기타직전 산출: {p}"

print("\n" + "="*60)
print(f"🏆 가장 유력한 B의 로직 (일치율 {best_score}%)")
print("-" * 60)
print(best_logic)
print("="*60)
