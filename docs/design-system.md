# `mimora-staff` — Design system

> **STATUS: APPROVED by the owner, 2026-10-02 — "Manifest", with the motion
> amendment in §6.** A design direction is a product decision; changing it
> needs the owner again.

The visual identity for the operational backoffice. **It borrows nothing from the
storefront**, and the storefront borrows nothing from it. This is deliberately a
**utility spec**, not a brand document — an operations console has no use for a
display face, a mood, or an editorial rhythm.

**`src/styles/tokens.css` is authoritative. This document must be kept honest
against it.** The restaurant staff document drifted: it lists four statuses where
the code has eight, with several relabelled. When they disagree, the code is
right and this document is stale.

---

## 0. Scope: one ground, one UI language

**This console is light-only and English-only.** An earlier draft of this
document gave it a dark ground and a four-combination QA matrix. That was wrong —
it came from a line in the kickoff brief that the brief has since withdrawn as
its own invention, and it contradicted the precedent.

**Verified on disk** rather than assumed: `restaurant-platform-staff` renders
`<html lang="en">`, declares **no `next-intl`**, has **no `src/i18n`**, has **no
`[locale]` routing**, and its `tokens.css` contains **zero** dark-ground or
`data-ground` declarations. English-only, light-only, deliberately.

**What that removes:** a second token set, per-ground contrast columns, and every
gate that existed to test a console dark mode.

**What it does not remove — and the distinction matters.** This app is where
staff *configure the storefront's* brand and theme, including its **dark**
palette. So the theme-configuration surface (§6) still previews all four
storefront combinations and still measures every pair it writes. **The console
having one ground and the storefront having two are unrelated facts.**

### The console's only Arabic requirement

Long Arabic **content** appears throughout — customer names, product titles,
addresses, order notes — even though the chrome is English. So:

- **Every field that renders merchant or customer content carries `dir="auto"`.**
  Not the page, not the layout — the field.
- **Long-Arabic overflow is tested** in tables, cards, and truncated cells.
- **Mixed-direction strings are the real hazard**, not Arabic alone. A name
  beside a Latin SKU, or an address containing digits and punctuation, is where
  neutral characters land on the wrong side without `dir="auto"`.

**This is a genuine new requirement, not an inherited one.** `dir="auto"`
appears **zero times** in `restaurant-platform-staff/src` today, while that app
renders bilingual content — so mixed-direction content there is rendering
without direction resolution. Treat it as a latent defect in the precedent
rather than a pattern to copy.

---

## 1. What the tooling recommended, and what was taken

Full account in `../../docs/store/05-design-consultation.md`.

**Taken — it confirmed this direction rather than changing it.** `ui-ux-pro-max`
returned **"Minimalism & Swiss Style"** for an operations dashboard — *"Best For:
Enterprise apps, dashboards, professional tools"*, performance cost `low`,
accessibility risk `low`. That is this document's instinct, independently
arrived at, and the restaurant staff app kept the same recommendation.
**Accepted.**

Also taken, from `apple-design-skill`: **elevation as a single-ground rule** — a
raised surface reads raised by being lighter than the ground beneath it, and a
row must never be darker than the ground it sits on. Its contrast target (7:1 for
custom colours, especially small text) prompted raising muted ink to **6.18:1**
from 5.40:1.

**Rejected — three things.**

- **Fira Code for headings.** The restaurant staff document already rejected this
  exact recommendation as *"a costume"*, and the reasoning is unchanged: a
  console has no display face, and dressing headings as code communicates
  nothing. Monospace is for **codes and figures** — SKUs, counts, money in
  columns — where it does real work. Same tool, same recommendation, second
  rejection.
- **Its palette, on measured grounds.** *"Industrial slate + stock green"*
  (`#334155` / `#059669` / `#F8FAFC`). The slate is fine. **The accent is not:
  `#059669` on `#F8FAFC` measures 3.60:1 — a text-contrast failure** — and its
  own `on-accent: #FFFFFF` measures **3.77:1**, also failing. A green accent is a
  reasonable instinct for inventory, but green is reserved here for the
  `delivered`/`verified` status role, and a status colour doubling as the primary
  action is the *"same colour meaning two things"* problem.
- **Its "Feature-Rich Showcase" pattern** — *"Hero (value prop) > Feature grid >
  Social proof > CTA"*, returned for an internal operations tool. **This app has
  no hero and no value proposition.** The same category error the restaurant
  recorded. Worth noting: the pattern field returned the *identical*
  landing-page answer for the storefront and for this console, which says
  something about the field rather than about either product.

**On `apple-design-skill`'s standing:** it ranks below this project's
requirements, and most of what it covers — window chrome, safe areas, bottom tab
bars, native components — is **not applicable** to a web backoffice. Its value
here was narrow: the elevation rule, the contrast target, and the
more-than-colour-alone rule this document already enforces.

---

## 2. The direction: **Manifest**

A shipping manifest is a dense, unglamorous document that has to be read
correctly at speed, by someone holding something else. That is this app.

**Cool neutral ground, high-contrast ink, one blue accent, and colour reserved
almost entirely for status.** Where the storefront is warm paper and brass, this
is grey-blue and functional — the two must never be mistaken for each other, and
a screenshot of one should be instantly distinguishable from the other.

**Serving both modes without becoming two products.** Operations and management
share one grid, one type scale and one status vocabulary; they differ only in
**density and target size**. A `--st-density` attribute on the layout root
switches the spacing scale and the minimum tap target — operations rows are
taller and touch-first, management tables are compact and pointer-first. Nothing
else changes, so nothing has to be designed twice.

---

## 3. Tokens — one ground

Only the `--ftk-*` roles that genuinely need to differ are redefined; the rest is
this app's own small vocabulary.

| Token | Value | Role |
|---|---|---|
| `--st-canvas` | `#F2F4F6` | App ground |
| `--st-surface` | `#FFFFFF` | Row, card, panel — **lighter than the ground, always** |
| `--st-ink` | `#101519` | Primary text |
| `--st-ink-muted` | `#525C66` | Meta, column headers |
| `--st-line` | `#E2E6EA` | **Decorative** hairline — table rules |
| `--st-line-strong` | `#7E8892` | **Meaningful** boundary — form controls, selection |
| `--st-accent` | `#12507E` | Links, primary action, active nav |
| `--st-focus` | `#12507E` | Focus ring |

| Pair | Ratio | Need |
|---|---|---|
| `ink` / `canvas` | **16.66:1** | 4.5 |
| `ink` / `surface` | **18.37:1** | 4.5 |
| `ink-muted` / `canvas` | **6.18:1** | 4.5 |
| `ink-muted` / `surface` | **6.81:1** | 4.5 |
| `accent` / `canvas` | **7.70:1** | 4.5 |
| `accent` / `surface` | **8.49:1** | 4.5 |
| `line-strong` / `canvas` | **3.27:1** | 3.0 (1.4.11) |
| `line-strong` / `surface` | **3.61:1** | 3.0 (1.4.11) |
| `focus` / `canvas` | **7.70:1** | 3.0 (1.4.11) |

**`--st-line` and `--st-line-strong` are two tokens for a measured reason.** A
single hairline at `#E2E6EA` measures **1.14:1** — fine for a table rule, and a
**1.4.11 failure** if the same token also draws a form-control boundary. Using
one token for both would ship an inaccessible input on every form in the app.

**Both palettes `ui-ux-pro-max` returned make exactly this mistake** — a single
`border` token measuring **1.17:1** (console) and **1.43:1** (storefront). That
is the clearest illustration of why tool output is measured before it is adopted.

**Elevation is a single-ground rule.** A raised surface is *lighter* than what is
beneath it. There is no second ground to invert, so there is nothing to test
twice — but a panel darker than its ground still reads as a hole rather than a
card, and that is the failure to avoid.

**Type:** `IBM Plex Sans` for UI, `IBM Plex Mono` for **codes and figures** —
SKUs, counts, money in columns, order numbers. **No display face.** Sizes: 20px
section heading, 14px body, 13px label, 13px mono. Line height 1.45 for UI, 1.7
for prose.

> **Mono is for Latin codes and Western figures only.** The storefront specimen
> proved that `IBM Plex Mono` has **no Arabic coverage** — Arabic set in it falls
> back silently to a system monospace and looks visibly wrong. Since this console
> renders Arabic *content* in the same tables as Latin SKUs, an Arabic customer
> name or product title must never be set in mono. It uses the sans face with
> `dir="auto"`.

**Density:** `--st-space-1..6` = 4 · 8 · 12 · 16 · 24 · 32 px.
`--st-tap-min` = **44px** in operations mode, 32px for pointer-only controls in
management mode. Radius 2px throughout — a functional edge, not a soft one.

---

## 4. Status vocabulary — fixed, learned, measured

**The same status reads identically on the board, in a list, on detail and in the
timeline.** Colour is **never** the sole carrier: every status is colour + icon +
label, always all three.

**Order status and payment status are separate axes, rendered as two signals.** A
COD order progresses while unpaid; a transfer order can be paid before it is
accepted. One combined badge loses the distinction staff act on.

Each value clears **4.5:1 on both the canvas and a row surface** — measured,
since a badge appears on both.

| Status | Hex | canvas / surface | Icon |
|---|---|---|---|
| **Order** | | | |
| `placed` | `#525C66` | 6.18 / 6.81 | dot |
| `confirmed` | `#12507E` | 7.70 / 8.49 | check |
| `processing` | `#7A4E00` | 6.53 / 7.20 | box |
| `dispatched` | `#5B3E9B` | 7.31 / 8.05 | truck-out |
| `in_transit` | `#0F6B75` | 5.63 / 6.21 | route |
| `delivered` / `collected` | `#1F6D45` | 5.72 / 6.30 | check-double |
| `cancelled` | `#525C66` | 6.18 / 6.81 | slash |
| `rejected` | `#A32218` | 6.80 / 7.50 | x |
| **Payment** | | | |
| `unpaid` / `proof_submitted` | `#7A4E00` | 6.53 / 7.20 | clock |
| `verified` | `#1F6D45` | 5.72 / 6.30 | shield-check |
| `refunded` | `#5B3E9B` | 7.31 / 8.05 | reverse |
| **Return** | | | |
| `returned` | `#8A4B00` | 6.17 / 6.80 | box-in |

**`cancelled` and `placed` deliberately share a colour** and are distinguished by
icon and label — a terminal non-event and a not-yet-actioned event are both
"neutral", and inventing a twelfth hue to separate them would weaken the whole
vocabulary. `[ASSUMPTION]` this is the right trade; if staff misread it in
practice, split it.

---

## 5. Inventory affordances — what a restaurant console never needed

**Stock must be readable without being read.** A number alone is not enough at
warehouse speed.

- **Stock level:** the count in mono, plus a state — `in stock` / `low` / `out` —
  carrying the `delivered` / `unpaid` / `rejected` colours respectively. The
  threshold is per-variant with a settings default.
- **Out of stock is never an absence.** A blank cell reads as "not loaded".

### The variant matrix editor — the hardest screen in the product

A grid of per-variant **SKU / price / stock** across the product's axes. Three
requirements, and the first causes real damage if missed:

1. **A combination that DOES NOT EXIST must be visibly distinct from one that
   exists with ZERO STOCK.** These are different facts. Conflating them produces
   either phantom inventory (selling what was never made) or unsellable products
   (a real variant treated as nonexistent). The non-existent cell is a
   **hatched, unfilled cell with no inputs at all**; a zero-stock cell is a
   normal cell with `0` and the `out` state. **Verified in a browser:** the
   hatch-versus-`0 out` distinction reads correctly at a glance on the light
   ground. They must not merely differ in shade.
2. **A duplicate axis combination must be impossible to express**, not rejected
   on save. `variantKey` enforces it at the database, and the UI must never let a
   user reach that error.
3. **Bulk edit down an axis** — every size-M row, every Olive row — because
   entering forty variants by hand is where errors come from. Bulk price, bulk
   stock set, bulk activate.

SKU uniqueness is surfaced **inline, before save**. Renaming an axis **display
name** is obviously safe; axis **keys** are not editable once variants exist, and
the UI says so rather than offering it and failing.

---

## 6. Tables, density, and the signature element

This app is mostly tables and forms, so the table *is* the design. Sticky header,
sticky first column on wide tables, right-aligned numerics in mono, zebra-free
rows separated by `--st-line`, and **the table's own container scrolls — never
the page**.

**Signature element: the status rail.** A 3px full-height bar on the
reading-start edge of every row and card, carrying the status colour. It gives a
list a scannable colour spine without turning the row into a coloured block, it
works identically on the board and in a table, and it is **direction-aware** —
on the start edge, so it behaves correctly beside `dir="auto"` content.

**Motion never costs time.** No scroll-reveal, no page transitions, no
staggered lists, no animated counters. 120ms for hover/focus, 200ms for
disclosure and overlays. `prefers-reduced-motion` gets a genuine non-animated
path.

**Owner amendment (2026-10-02): purposeful motion is allowed** where it
explains a change rather than decorates one — overlays and drawers entering
from their anchor, toasts, an optimistic row update settling into place, the
active-navigation indicator moving between items, and the sign-in screen.
All of it through `motion` (`motion/react`), short (≤240ms), interruptible,
and absent under `prefers-reduced-motion`. Nothing animates on page load in
operations views, and nothing delays an action.

---

## 7. The theme configuration surface — it must prevent, not detect

**This is the console screen that concerns the storefront's two grounds.** Staff
configure the merchant's brand colours here; the storefront renders them. The
console's own single ground is irrelevant to this screen's job.

It previews **all four storefront combinations** — light/`ar`, light/`en`,
dark/`ar`, dark/`en` — and shows the **measured ratio for every pair it is about
to write**, before it writes.

`[ASSUMPTION → D-2]` **Only brand fills are overridable**, validated against both
storefront grounds, falling back to the derived value. Text, border and state
colours are not offered at all — they carry the measured ratios.
Ground-dependent `*-soft` surfaces are not offered either.

**Two recorded failures define this, and both look like over-restriction until
you know they happened:**

1. An operator supplied a fill *and* its ink, with nothing checking the pair.
   `#6B8F71` with white measures **3.63:1** and failed **16 nodes across 8
   routes** the moment a second store rendered. The first store's values happened
   to pass, which is why it never surfaced. **So the ink is derived, and this UI
   does not offer to set it.**
2. A brand `*-soft` **surface** hex painted a cart notice cream-on-cream on the
   storefront's dark ground — a surface is ground-dependent, and one inline value
   wins over *both* ground blocks. **Every contrast pair still passed**, because
   the failing pair was substituted at runtime. It was found in a screenshot.

**The design rule that follows:** an unreadable configuration must be
**impossible to express**, not caught afterwards. A colour input that can produce
a failure is the wrong control. Where a merchant's chosen fill yields no
compliant palette, the screen rejects it **with the measured ratio shown**.

---

## 8. Accessibility and verification

**WCAG 2.1 AA**, ratios in §3 and §4, including non-text contrast (1.4.11) for
control boundaries and focus rings — the case that matters most on a dense
console.

Touch targets **≥ 44px** in operations mode. Full keyboard operability including
the variant matrix, navigable cell to cell. Visible focus everywhere, trapped in
dialogs, restored on close. Every input labelled, errors linked with
`aria-describedby` and announced. Live regions for status changes. **Colour never
the sole carrier of state.**

Browser QA at **375 / 768 / 1280 / 1440**, portrait and landscape on tablet, **on
the single ground**. **No horizontal page scroll at any width** — a wide table's
own container may overflow; the page must not.

**Arabic content, not Arabic chrome:** every content field verified with long
Arabic values and with mixed Arabic-plus-Latin strings, in tables, cards and
truncated cells, confirming `dir="auto"` resolves each field correctly.

**Confirm the gates can fail:** the contrast gate recomputes every pair above
from `tokens.css` rather than trusting this table, and is verified to go red when
a value is deliberately dropped below threshold. *A test that cannot fail proves
nothing.*
