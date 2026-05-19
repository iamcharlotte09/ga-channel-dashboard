import json
from collections import defaultdict
import math

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
month_idx = months.index(target_month)
recent_12_months = months[max(0, month_idx - 11): month_idx + 1]

# What if Top 20 is sorted by ALL sheets performance in 2026-04, but MS is calculated on '월초'?
recent_records = [r for r in records if r['monthKey'] in recent_12_months and r['sheetName'] == '월초']

current_records_all = [r for r in records if r['monthKey'] == target_month and r.get('productName')]

def analyze_insurer(insurer_name):
    ins_recent = [r for r in recent_records if r['insurerName'] == insurer_name]
    total_raw = sum(r['performanceThousandKrw'] for r in ins_recent)
    
    ins_current_all = [r for r in current_records_all if r['insurerName'] == insurer_name]
    curr_grouped_all = defaultdict(float)
    for r in ins_current_all:
        curr_grouped_all[r['gaName']] += r['performanceThousandKrw']
        
    sorted_curr_gas_all = sorted(curr_grouped_all.items(), key=lambda x: x[1], reverse=True)
    top_20_all = set(x[0] for x in sorted_curr_gas_all[:20])
    
    other_perf = sum(r['performanceThousandKrw'] for r in ins_recent if r['gaName'] not in top_20_all)
    pct = (other_perf / total_raw) * 100 if total_raw > 0 else 0
    print(f"[{insurer_name}] Top 20 sorted by ALL sheets: Other% = {pct:.1f}%")

for ins in ['삼성생명', 'NH농협생명', 'DB생명', 'KB라이프', 'IM라이프', '메트라이프생명', '신한라이프', '동양생명']:
    analyze_insurer(ins)
