# Lunch Tracker

A simple website that helps students track what they spend on school breakfast and lunch.
Pick items from the menu, add them to your day, set a budget, and look back at your history.

**No install or build step.** Open `index.html`, or host the repo root with GitHub Pages.

## Features

- **Menu** of 72 items from the school sheet, with search and filters (meal, station, price / N/A).
- **N/A prices:** items with no listed price show `N/A`. They can still be logged, but add $0 to the total, and the tracker tells you how many were left out.
- **Estimated prices:** prices that the sheet marks as a guess show an `est.` tag.
- **Meal combos:** one-tap *Student Breakfast* ($2.50) and *Student Lunch Combo* ($4.50).
- **Budget goals:** daily and weekly limits with a progress bar (yellow at 80%, red when over).
- **History:** 14-day spending chart, weekly / monthly totals, and a day-by-day log.
- **Nutrition:** calories on every card; fat, sodium, sugar, protein and more under *Nutrition*.
- Works on phones, light and dark mode. Data is saved in the browser (`localStorage`) on that device only.

## Privacy and security

- No accounts, no network requests, no third-party scripts or fonts. Nothing leaves the browser.
- A strict Content-Security-Policy (set in `index.html`) allows only this site's own scripts and styles.
- Everything read back from saved data is validated, so a corrupted or edited save can't break the totals or inject markup.
- Saved data lives in the browser's `localStorage`, so on a shared computer anyone using the same browser profile can see it.

## Publishing with GitHub Pages

Settings → Pages → *Build and deployment* → **Deploy from a branch** → `main` / `(root)`.

## Updating the menu data

`menu-data.js` is generated from the spreadsheet (exported as PDF):

```sh
pdftotext -raw Lunch_Spending_Tracker.pdf raw.txt
python3 tools/build_menu.py Lunch_Spending_Tracker.pdf raw.txt menu-data.js
```

Needs `pdftotext` (poppler) and `pip install pdfplumber`.

### How the sheet was interpreted

- The sheet has 164 rows because the same item appears once per Food ID / days-on-menu. Rows are merged by **item + serving size** into one menu option.
- **Item price** column → price. Blank → `N/A`. "Price is a guess? = Yes" → `est.` (only Mozzarella Sticks is confirmed).
- Bacon and Belgian Waffle have a $2.75 item price even though their source says "No item-specific price found". They are shown as $2.75 with the `est.` tag.
- The "Meal price context" column ($2.50 breakfast, $4.50 lunch) is *not* an item price. It's used only for the combo buttons.
- Serving sizes are tidied for reading (`ozw` → `oz`, `0.125 cut` → `1/8 of a whole`).
