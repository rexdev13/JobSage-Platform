import csv, re, subprocess, sys, psycopg2

LEGAL = re.compile(r'\b(ltd|limited|llp|plc|inc|corp|company|co|uk|group|holdings|the)\b', re.I)
def norm(s):
    s = s.lower().replace('&', ' and ')
    s = re.sub(r'[^a-z0-9 ]', ' ', s)
    s = LEGAL.sub(' ', s)
    return re.sub(r'\s+', ' ', s).strip()

def sector(sic):
    if 'religious' in sic.lower(): return 'Faith'
    if 'hairdress' in sic.lower() or 'beauty' in sic.lower(): return 'Beauty'
    m = re.match(r'(\d{5})', sic.strip())
    if not m: return None
    d = int(m.group(1)) // 1000
    if 1 <= d <= 3: return 'Agriculture'
    if 5 <= d <= 9: return 'Energy'
    if 10 <= d <= 33: return 'Manufacturing'
    if 35 <= d <= 39: return 'Energy'
    if 41 <= d <= 43: return 'Construction'
    if d in (45, 46, 47): return 'Retail'
    if 49 <= d <= 53: return 'Transport'
    if d in (55, 56, 79): return 'Hospitality'
    if d in (58, 59, 60, 73, 90, 91, 92, 93): return 'Media & Creative'
    if d in (61, 62, 63, 72): return 'Technology'
    if 64 <= d <= 66: return 'Finance'
    if d == 68: return 'Property'
    if d in (69, 70, 74): return 'Legal & Professional'
    if d == 71: return 'Engineering'
    if d == 75: return 'Healthcare'
    if d == 78: return 'Recruitment'
    if d == 80: return 'Security'
    if d == 84: return 'Public Services'
    if d == 85: return 'Education'
    if d == 86: return 'Healthcare'
    if d in (87, 88): return 'Social Care'
    if d == 96: return 'Beauty' if False else 'Services'
    return 'Services'

conn = psycopg2.connect('postgres://postgres:postgres@localhost:5432/jobsage')
cur = conn.cursor()
cur.execute("SELECT organisation_name FROM sponsor_licences WHERE industry IS NULL OR btrim(industry)=''")
want = {}
for (name,) in cur.fetchall():
    want.setdefault(norm(name), name)
print(f'unlabeled sponsors={len(want)}', flush=True)

found = {}
p = subprocess.Popen(['unzip', '-p', '/home/ubuntu/ch_data.zip'], stdout=subprocess.PIPE, text=True)
rdr = csv.reader(p.stdout)
hdr = next(rdr)
name_i = 0
sic_i = hdr.index('SICCode.SicText_1')
for row in rdr:
    if not row: continue
    k = norm(row[name_i])
    if k in want:
        s = sector(row[sic_i])
        if s and want[k] not in found:
            found[want[k]] = s
p.wait()
print(f'matched={len(found)}', flush=True)

cur.executemany("UPDATE sponsor_licences SET industry=%s WHERE organisation_name=%s AND (industry IS NULL OR btrim(industry)='')",
                [(s, n) for n, s in found.items()])
conn.commit()
from collections import Counter
for k, v in Counter(found.values()).most_common():
    print(f'  {k}: {v}')
