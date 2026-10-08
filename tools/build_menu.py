import re, json, sys, collections
from fractions import Fraction
import pdfplumber

# Usage: pdftotext -raw Lunch_Spending_Tracker.pdf raw.txt
#        python3 tools/build_menu.py Lunch_Spending_Tracker.pdf raw.txt menu-data.js
PDF, RAW, OUT = sys.argv[1:4]

# ---------- text records (pdftotext -raw) ----------
lines = open(RAW, encoding='utf-8').read().split('\n')
start = next(i for i, l in enumerate(lines) if 'Vitamin A (IU)' in l) + 1
lines = [l.strip() for l in lines[start:] if l.strip()]
num_tail = re.compile(r'(?:^|\s)-?\d+(?:\.\d+)?(?:\s+-?\d+(?:\.\d+)?){7,}\s*$')
records, buf = [], []
for l in lines:
    buf.append(l)
    if num_tail.search(l):
        records.append(' '.join(buf)); buf = []
assert not buf, buf

STATIONS = ['Daily Serve Entree', 'Grill; Tortilla', 'Test Kitchen', 'Condiments', 'Bakery', 'Tortilla', 'Pizza', 'Grill', 'Fruit']
rec_re = re.compile(
    r'^(?P<item>.+?)\s*(?:(?P<meal>breakfast; lunch|breakfast|lunch)\s+)?(?P<station>' + '|'.join(map(re.escape, STATIONS)) + r')\s+'
    r'(?P<serving>[\d./]+\s+(?:fl oz|\S+))\s+(?:(?P<price>\$\d+\.\d\d)\s+)?(?P<rest>.*)$')

# ---------- nutrient columns (coordinates) ----------
NUT = ['calories','fat','satFat','transFat','cholesterol','sodium','carbs','fiber','sugar','addedSugar','protein','potassium','calcium','iron','vitaminC','vitaminA']
COLX = [305,322,340,357,374,391,408,425,442,459,476,493,510,527,544,561]
page = pdfplumber.open(PDF).pages[0]
# Rebuild each cell's text from consecutive characters in content-stream order, so long
# notes that overflow into the number columns can't merge with the numbers.
pieces, cur = [], []
for ch in page.chars:
    if cur and (abs(ch['x0'] - cur[-1]['x1']) > 0.35 or abs(ch['top'] - cur[-1]['top']) > 0.5):
        pieces.append(cur); cur = []
    cur.append(ch)
if cur: pieces.append(cur)
nw = []
for pc in pieces:
    t = ''.join(c['text'] for c in pc)
    if pc[0]['top'] > 62 and re.fullmatch(r'-?\d+(\.\d+)?', t) and pc[0]['x0'] >= 285:
        nw.append(dict(text=t, x1=pc[-1]['x1'], top=pc[0]['top']))
nw.sort(key=lambda w: w['top'])
bands = []
for w in nw:
    if bands and w['top'] - bands[-1][-1]['top'] < 1.0: bands[-1].append(w)
    else: bands.append([w])
assert len(bands) == len(records), (len(bands), len(records))

rows = []
for rec, band in zip(records, bands):
    m = rec_re.match(rec); assert m, rec[:120]
    d = m.groupdict()
    rest = re.sub(r'(?:\s+-?\d+(?:\.\d+)?){8,}\s*$', '', d['rest'])
    g = re.match(r'(?P<src>.*?)\s+(?:(?P<guess>Yes|No)\s+)?Student', rest)
    src = g.group('src') if g else rest
    nut = {}
    for w in band:
        i = min(range(len(COLX)), key=lambda k: abs(COLX[k] - w['x1']))
        if abs(COLX[i] - w['x1']) < 4:
            v = float(w['text']); nut[NUT[i]] = int(v) if v == int(v) else v
    rows.append(dict(item=d['item'].strip(), meal=d['meal'], station=d['station'], serving=d['serving'],
                     price=float(d['price'][1:]) if d['price'] else None,
                     source=None if src.startswith('No item-specific') else src.replace('District list: ', ''),
                     estimated=(g.group('guess') == 'Yes') if g and g.group('guess') else None,
                     nutrition=nut))

# ---------- friendly serving text ----------
PLURAL = {'slice': 'slices', 'bowl': 'bowls', 'cookie': 'cookies', 'piece': 'pieces', 'container': 'containers', 'cup': 'cups', 'each': 'pieces', 'serving': 'servings'}
def fmt_num(x):
    f = Fraction(x).limit_denominator(64)
    if x < 1 and abs(float(f) - x) < 0.006:
        return f'{f.numerator}/{f.denominator}'
    return f'{x:g}'
def friendly(s):
    n, u = s.split(' ', 1)
    x = float(n); qty = fmt_num(x)
    if u == 'cut': return f'{qty} of a whole'
    unit = {'ozw': 'oz', 'lbs': 'lb', 'cups': 'cup', 'each': 'piece'}.get(u, u)
    if x > 1 and unit in PLURAL: unit = PLURAL[unit]
    elif x > 1 and unit == 'piece': unit = 'pieces'
    return f'{qty} {unit}'

# ---------- merge into menu items ----------
by_item = collections.OrderedDict()
for r in rows:
    key = (r['item'], r['serving'])
    it = by_item.setdefault(key, dict(name=r['item'], serving=r['serving'], servingLabel=friendly(r['serving']),
                                      meals=set(), station=r['station'], price=None, estimated=None, source=None,
                                      priceNote=None, nutrition={}))
    if r['meal']:
        it['meals'].update(x.strip() for x in r['meal'].split(';'))
    if r['price'] is not None and it['price'] is None:
        it['price'] = r['price']; it['estimated'] = r['estimated']; it['source'] = r['source']
        it['priceNote'] = 'Listed price, but the sheet says no item-specific price was found' if r['source'] is None else None
    if not it['nutrition']: it['nutrition'] = r['nutrition']
# meal fill-in for blanks: inherit from same item name
name_meals = collections.defaultdict(set)
for it in by_item.values(): name_meals[it['name']] |= it['meals']
items = []
for it in by_item.values():
    meals = it['meals'] or name_meals[it['name']]
    it['meals'] = sorted(meals, key=lambda m: ['breakfast','lunch'].index(m))
    items.append(it)
items.sort(key=lambda i: (i['name'].lower(), i['serving']))
for it in items:
    it['id'] = re.sub(r'[^a-z0-9]+', '-', f"{it['name']} {it['serving']}".lower()).strip('-')
    it['station'] = it['station'].replace('; ', ' / ')
    del it['serving']
assert len({i['id'] for i in items}) == len(items)

# Meal price context from the sheet ("Student breakfast $2.50", "Student lunch combo $4.50")
raw_text = open(RAW, encoding='utf-8').read()
assert 'Student breakfast $2.50' in raw_text and 'Student lunch combo $4.50' in raw_text
combos = {'breakfast': {'name': 'Student Breakfast', 'priceCents': 250},
          'lunch': {'name': 'Student Lunch Combo', 'priceCents': 450}}
with open(OUT, 'w', encoding='utf-8') as f:
    f.write('// Generated by tools/build_menu.py from the Lunch Spending Tracker sheet. Do not edit by hand.\n')
    f.write('window.MENU_ITEMS = ' + json.dumps(items, indent=1, ensure_ascii=False) + ';\n')
    f.write('window.MEAL_COMBOS = ' + json.dumps(combos, indent=1) + ';\n')
print(len(rows), 'rows ->', len(items), 'menu options;', sum(i['price'] is None for i in items), 'N/A prices')
