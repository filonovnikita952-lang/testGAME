# Mobile layout fixes and verification

The previous layout locked html/body scrolling, capped the lobby to the viewport,
and propagated 100% heights through nested flex/grid containers with hidden
overflow. At a 390 px viewport the populated roster measured zero height; the
other columns were squeezed into approximately 181 px. Item detail panels could
cover inventory content, and equipment/participants became inaccessible. The
680 px breakpoint changed the column count without removing those constraints.
Rules retained a 200 px sidebar minimum, and a retained page-entrance transform changed the containing block for fixed
dialogs. The mobile header inherited a
column direction from the 860 px breakpoint.

The responsive stylesheet restores document scrolling, lets lobby content size
its rows, uses two columns below 1200 px and one below 768 px, and keeps the wide
four-column layout. Character panels, equipment, bags and role controls remain
in the document. The bounded chat history remains scrollable intentionally;
other mobile lobby panels use page scrolling. The mobile header is a compact
logo/button row with navigation expanding in normal flow. Rules uses a keyboard
accessible in-page categories disclosure on phones and retains its desktop
sidebar. Selection indicates the active category and returns focus to the trigger.
Admin category controls remain accessible, including opening the category form.

Touch and keyboard users can select an item using a native picker, read its full
name/description, and choose container/X/Y in the move form. All moves still use
the existing server endpoint, permissions, placement checks and item versions.
Drag behavior is preserved for mouse pointers; touch scrolling no longer starts
a drag. Rotate, equip, transfer, drop and split controls are available in item
details where applicable. Long labels stay within their grid markers; full names
are available in the picker, accessible labels and details. Details no longer
require an image element that the earlier image cleanup removed. Live refreshes
preserve draft move fields and notes. No backend/game rule changes, new polling,
service or production dependency was added.

## Screenshots

All screenshots use synthetic accounts, long names, chat, rules, equipment and
an 8×6 bag in a disposable /tmp database. Before images were captured from a
source snapshot of main (`d2d8381`) against that fixture. They use a 390×844 CSS
pixel viewport; the Rules before image includes the original horizontal overflow.
Desktop screenshots use 1440×844. Files contain no production/user data.

| Page | Before | After |
| --- | --- | --- |
| Lobby | [before](mobile-screenshots/lobby-before.png) | [after](mobile-screenshots/lobby-after.png) |
| Rules | [before](mobile-screenshots/rules-before.png) | [after](mobile-screenshots/rules-after.png) |

Additional views: [selected item and touch move controls](mobile-screenshots/lobby-inventory-after.png),
[expanded rule](mobile-screenshots/rules-expanded.png),
[desktop lobby](mobile-screenshots/lobby-desktop.png),
[desktop Rules](mobile-screenshots/rules-desktop.png).

## Checks performed

- Chromium/Playwright: **252 page/viewport/role combinations** at widths 320, 375,
  390, 430, 768, 1024 and 1440, with heights 844 and 390. Anonymous, master/admin,
  player and new-account/empty-lobby states were covered. Admin coverage includes
  home, profile, News, Skills, user administration, skill administration, login,
  signup, lobby and Rules. No horizontal document overflow, overlapping lobby
  columns, unreachable character tabs or JavaScript errors were detected.
- Interactions: navigation open/close and Escape; Rules selection, selected label,
  focus restoration, Escape, admin category creation form, expanded rules; touch
  selection and move, server rejection of an invalid position, forced network
  failure/retry, preservation of unsaved coordinates/notes during refresh;
  desktop mouse drag and context menu edge placement/Escape; transfer dialog close from its input with focus restoration; collapse/expand
  item details, populated extra bag and equipment visibility; chat submission at
  a short viewport simulating keyboard space.
- Existing Python suite: **18 passed** (Python 3.10/current pinned dependencies).
  Existing polling Node tests: **2 passed**. Changed JavaScript syntax checks and
  git diff whitespace checks passed.
- Images above were visually inspected. Automation checks structure and reachable
  interactions; it is not a proof of every possible game-data layout.

No physical iOS/Safari or Android device, real on-screen keyboard, PythonAnywhere
worker, high-concurrency scenario or strict 512 MB memory limit was available for
verification. Portrait/landscape and touch were emulated in Chromium. Mouse drag
code remains in place; the interaction automation focuses on the new touch
alternative with one desktop mouse-drag regression check; this is not an exhaustive drag/drop suite. No new heavy
client framework or server dependency is required; browser testing runs only in
development.

To repeat locally (never use a production database; the fixture creates data):

```sh
.venv/bin/pip install playwright pytest  # development tools only
DRA_DATA_DIR=/tmp/dra-mobile .venv/bin/python tests/mobile_fixture.py
DRA_DATA_DIR=/tmp/dra-mobile .venv/bin/gunicorn --workers 1 --threads 2 --bind 127.0.0.1:5002 --worker-tmp-dir /tmp app:app
# In another terminal, with system Chromium at /usr/bin/chromium:
DRA_DATA_DIR=/tmp/dra-mobile .venv/bin/python tests/mobile_smoke.py
DRA_DATA_DIR=/tmp/dra-mobile .venv/bin/python tests/mobile_interactions.py
DRA_DATA_DIR=/tmp/dra-unit .venv/bin/python -m pytest -q
node --test tests/test_polling.cjs
```

Use a fresh /tmp/dra-mobile directory for independent fixture creation. Browser
checks expect fixture IDs 1–3 and modify only this synthetic database. They should
run sequentially. Before screenshots are preserved reference artifacts; the smoke
script refreshes after/desktop screenshots.

## PythonAnywhere deployment

1. Open a Bash console and change to the existing Source code directory shown in
   the Web tab. Preserve local changes. Fetch the reviewed branch:
   `git fetch origin` then `git switch --track origin/fix/mobile-lobby-rules-navigation`.
   If already checked out, use `git pull --ff-only`. After merge, deploy updated
   main instead. This PR does not merge itself.
2. Keep the existing virtualenv, SECRET_KEY, DRA_DATA_DIR and database. This change
   needs no package install, migration, reset or fixture execution on production.
   Follow [the PythonAnywhere runtime guide](PYTHONANYWHERE_POOL_FIX.md) if that
   environment still needs its earlier virtualenv correction.
3. In Web → Static files, ensure `/static/` maps to **this checkout's static
   directory**, rather than an older copy. New files are responsive.css and
   navigation.js; inventory.js and rules.js also change. Template asset URLs have
   a new version query to avoid mixing the new markup with cached old handlers.
4. Click **Reload** for the Web app. Do not run Gunicorn alongside PythonAnywhere's
   managed WSGI server. Hard-refresh the browser and confirm the new stylesheet
   and scripts return 200, then verify the header menu, Rules categories, populated
   lobby tabs, inventory move, chat and player/master controls on a phone. Check
   the error log. Production database and user uploads remain unchanged.
