---
name: data-visualization
description: Design guidance for any chart, graph, dashboard, or stat tile produced for a report (sprint/backlog visuals, Allure trend summaries, consolidated project reports) — in a Mermaid/SVG diagram, a generated PDF/DOCX, or a Confluence page. Read before choosing chart colors or laying out a dashboard. Use whenever documenter/reporter is about to add a chart to a report. Skip for a plain data table with no chart — nothing here applies.
---
# Data visualization

Turns "make the report chart look good" into a procedure with a runnable check, so the result
is right by construction. Color comes **last** — most bad charts pick colors first.

## Procedure
1. **Pick the form by the data's job**: magnitude (bar), identity (categorical), polarity
   (diverging), change-over-time (line), or a single headline number (a stat tile — not every
   metric needs a chart).
2. **Assign color by job, not by feel**: categorical = one hue per category in a fixed order
   (never cycled — a new category never repaints the others); sequential = one hue, light to
   dark; diverging = two hues plus a neutral midpoint; status (pass/fail/flaky) = reserved
   colors, never reused for a plain category.
3. **Validate the palette before shipping it** — run
   `node skills/data-visualization/scripts/validate_palette.js "<hex,hex,...>" --mode light`.
   It checks colorblind-safe separation between adjacent colors, a lightness/contrast floor
   against the report background, and flags anything that fails. Fix what it flags, then
   re-run for `--mode dark` if the report has a dark variant.
4. **One axis.** Never a dual-axis chart (two different y-scales on one plot) — split into two
   charts or index both series to a common base instead. This is the single most common
   charting mistake.
5. **Label without relying on color alone**: a legend for 2+ series (skip it for one — the
   title already names it); direct labels on the 1-2 series that matter, not every point.
6. **Look at the rendered output** before calling it done — the validator checks color, not
   layout; open the generated PDF/DOCX/Confluence page and check for label collisions/overflow.

## Non-negotiables
- Never a rainbow palette, and never a hue at the diverging midpoint.
- Text (axis labels, numbers, legend text) stays in a neutral ink color — only the mark itself
  carries the category color.
- A report chart with a colorblind-unsafe categorical palette needs a secondary encoding
  (pattern, direct label) — color alone is not enough.

## Output
When adding a chart to a report, state: the form chosen and why, the palette used and its
validator result, and confirmation the rendered output was actually looked at (not just
generated).
