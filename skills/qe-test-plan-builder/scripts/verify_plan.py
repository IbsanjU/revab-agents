#!/usr/bin/env python3
"""
verify_plan.py — mechanical verification for QE test plans and test case suites.

Checks what a script can check reliably, so the judgment passes in
SKILL.md get full attention. Findings are signals, not verdicts: a
duplicate reference ID may be faithfully reconstructed from a source
document, and an unused glossary term may be one the reviewer wants kept.
Report findings; let the user decide.

Usage:
    python3 verify_plan.py <file.md>
    python3 verify_plan.py <file.md> --type cases
    python3 verify_plan.py <file.md> --json
"""

import argparse
import json
import re
import sys
from collections import Counter, OrderedDict

EXPECTED_SECTIONS = [
    "Table of Contents",
    "Project Overview",
    "Referenced Documents",
    "Project Scope",
    "Testing Milestone",
    "Test Types",
    "Project Escalation Process",
    "Test Entry and Exit Criteria",
    "Test Environment",
    "Test Assumptions, Constraints & Dependencies",
    "Roles and Responsibilities",
    "Testing Risks",
    "Testing Communication Process",
    "Defect Management",
    "Glossary of Terms",
]

EXPECTED_SUBSECTIONS = [
    "2.1", "2.2", "2.3", "2.4",
    "3.1", "3.2",
    "4.1", "4.2", "4.3",
    "9.1", "9.2",
]

CASE_REQUIRED_FIELDS = ["Title", "Priority", "Pass Criteria", "Fail Criteria"]

PLACEHOLDER_PATTERNS = [
    (r"\bLorem ipsum\b", "lorem ipsum placeholder"),
    (r"\bXXX+\b", "XXX placeholder"),
    (r"\byour name here\b", "unfilled placeholder"),
    (r"\[insert[^\]]*\]", "unfilled bracket placeholder"),
    (r"\bFIXME\b", "FIXME marker"),
]


class Report:
    def __init__(self):
        self.sections = OrderedDict()

    def add(self, section, item):
        self.sections.setdefault(section, []).append(item)

    def count(self):
        return sum(len(v) for v in self.sections.values())


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def strip_code_fences(lines):
    """Return lines with fenced code blocks blanked, preserving indices."""
    out, in_fence = [], False
    for line in lines:
        if line.strip().startswith("```"):
            in_fence = not in_fence
            out.append("")
            continue
        out.append("" if in_fence else line)
    return out


def find_headings(lines):
    """[(line_no, level, raw_text, leading_number_or_None)]"""
    headings = []
    for i, line in enumerate(lines, 1):
        m = re.match(r"^(#{1,6})\s+(.*?)\s*$", line)
        if not m:
            continue
        level, text = len(m.group(1)), m.group(2)
        num = re.match(r"^([\d]+(?:\.[\d]+)*)\.?\s", text)
        headings.append((i, level, text, num.group(1) if num else None))
    return headings


def check_sections(headings, report):
    heading_text = " || ".join(h[2] for h in headings)
    for idx, name in enumerate(EXPECTED_SECTIONS, 1):
        key = name.split(",")[0][:22]
        if key.lower() not in heading_text.lower():
            report.add("Missing sections", f"Section {idx} '{name}' not found")

    numbers = [h[3] for h in headings if h[3] and "." in h[3]]
    for sub in EXPECTED_SUBSECTIONS:
        if sub not in numbers:
            report.add("Missing sub-sections", f"Sub-section {sub} not found")


def check_toc(lines, headings, report):
    toc_start = toc_end = None
    for i, (ln, _lvl, text, _n) in enumerate(headings):
        if "table of contents" in text.lower():
            toc_start = ln
            toc_end = headings[i + 1][0] if i + 1 < len(headings) else len(lines)
            break
    if toc_start is None:
        report.add("Table of contents", "No Table of Contents heading found")
        return

    entries = []
    for line in lines[toc_start:toc_end - 1]:
        m = re.match(r"^\s*[-*]\s+\[([^\]]+)\]", line)
        if m:
            entries.append(m.group(1).strip())
    if not entries:
        report.add("Table of contents", "TOC present but contains no link entries")
        return

    body = [h[2].strip() for h in headings]
    body_norm = [re.sub(r"\s+", " ", t).lower() for t in body]

    for entry in entries:
        e = re.sub(r"\s+", " ", entry).lower()
        if not any(e in b or b in e for b in body_norm):
            report.add("Table of contents",
                       f"TOC entry '{entry}' has no matching heading")

    toc_norm = [re.sub(r"\s+", " ", e).lower() for e in entries]
    for ln, lvl, text, num in headings:
        if lvl > 3 or not num:
            continue
        t = re.sub(r"\s+", " ", text).lower()
        if "table of contents" in t:
            continue
        if not any(t in e or e in t for e in toc_norm):
            report.add("Table of contents",
                       f"Heading '{text}' (line {ln}) missing from TOC")


def split_row(line):
    s = line.strip().strip("|")
    return [c.strip() for c in re.split(r"(?<!\\)\|", s)]


def check_tables(lines, report):
    i, n = 0, len(lines)
    while i < n:
        line = lines[i]
        if line.strip().startswith("|") and i + 1 < n and \
                re.match(r"^\s*\|[\s:|-]+\|\s*$", lines[i + 1]):
            header_no = i + 1
            cols = len(split_row(line))
            j = i + 2
            rows = 0
            while j < n and lines[j].strip().startswith("|"):
                got = len(split_row(lines[j]))
                if got != cols:
                    report.add(
                        "Malformed tables",
                        f"Line {j+1}: row has {got} cells, header has {cols}",
                    )
                rows += 1
                j += 1
            if rows == 0:
                report.add("Malformed tables",
                           f"Line {header_no}: table header with no data rows")
            i = j
        else:
            i += 1


def check_tbds(lines, headings, report):
    def section_for(ln):
        cur = "(before first heading)"
        for h_ln, _lvl, text, _num in headings:
            if h_ln <= ln:
                cur = text
            else:
                break
        return cur

    for i, line in enumerate(lines, 1):
        for token in ("TBD", "TBA"):
            if re.search(rf"\b{token}\b", line):
                report.add("Open fields",
                           f"Line {i} [{section_for(i)}]: {token}")
                break


def check_reference_ids(lines, report):
    ids = []
    for i, line in enumerate(lines, 1):
        if not line.strip().startswith("|"):
            continue
        cells = split_row(line)
        if not cells:
            continue
        m = re.match(r"^([ACD])(\d{3})$", cells[0].strip().strip("`*"))
        if m:
            ids.append((cells[0].strip(), i, cells[1].strip() if len(cells) > 1 else ""))

    for rid, count in Counter(r[0] for r in ids).items():
        if count > 1:
            where = ", ".join(str(r[1]) for r in ids if r[0] == rid)
            report.add("Reference IDs",
                       f"'{rid}' appears {count} times (lines {where}) — "
                       f"verify whether intentional")

    for rid, ln, typ in ids:
        if typ and typ.strip("`*").upper() not in ("", rid[0]):
            report.add("Reference IDs",
                       f"Line {ln}: '{rid}' has Type column '{typ}' — "
                       f"expected '{rid[0]}'")

    for letter in "ACD":
        nums = sorted(int(r[0][1:]) for r in ids if r[0][0] == letter)
        if not nums:
            continue
        expected = list(range(1, len(nums) + 1))
        if sorted(set(nums)) != expected[:len(set(nums))]:
            report.add("Reference IDs",
                       f"{letter}-series not sequential from {letter}001: "
                       f"{[f'{letter}{n:03d}' for n in nums]}")


def check_glossary(lines, headings, report):
    start = end = None
    for i, (ln, _lvl, text, _n) in enumerate(headings):
        if "glossary" in text.lower():
            start = ln
            end = headings[i + 1][0] if i + 1 < len(headings) else len(lines) + 1
            break
    if start is None:
        return

    acronyms = []
    for line in lines[start:end - 1]:
        if not line.strip().startswith("|"):
            continue
        cells = split_row(line)
        if len(cells) >= 2:
            a = cells[0].strip().strip("`*")
            if re.match(r"^[A-Z][A-Z0-9/_-]{1,14}$", a) and a.lower() != "acronym":
                acronyms.append(a)

    body = "\n".join(lines[:start - 1])
    for a in acronyms:
        if len(re.findall(rf"\b{re.escape(a)}\b", body)) == 0:
            report.add("Glossary",
                       f"'{a}' defined but never used in the document body")

    for a, c in Counter(acronyms).items():
        if c > 1:
            report.add("Glossary", f"'{a}' defined {c} times")


def check_placeholders(lines, report):
    for i, line in enumerate(lines, 1):
        for pattern, label in PLACEHOLDER_PATTERNS:
            if re.search(pattern, line, re.IGNORECASE):
                report.add("Placeholders", f"Line {i}: {label}")


def check_cases(text, lines, report):
    ids = re.findall(r"([A-Z][A-Z0-9]*-TC-)(\d+)", text)
    if not ids:
        report.add("Test cases", "No test case IDs found (expected PREFIX-TC-NNN)")
        return

    prefixes = {p for p, _ in ids}
    if len(prefixes) > 1:
        report.add("Test cases", f"Mixed ID prefixes: {sorted(prefixes)}")

    nums = sorted({int(n) for _, n in ids})
    missing = [n for n in range(min(nums), max(nums) + 1) if n not in nums]
    if missing:
        report.add("Test cases",
                   f"ID gaps: {', '.join(f'{n:03d}' for n in missing)}")

    heading_ids = re.findall(r"^#{2,4}\s+([A-Z][A-Z0-9]*-TC-\d+)\s*$",
                             text, re.MULTILINE)
    dupes = [i for i, c in Counter(heading_ids).items() if c > 1]
    if dupes:
        report.add("Test cases", f"Duplicate case headings: {sorted(dupes)}")

    blocks = re.split(r"^#{2,4}\s+(?=[A-Z][A-Z0-9]*-TC-\d+\s*$)", text,
                      flags=re.MULTILINE)[1:]
    for block in blocks:
        cid = block.split("\n", 1)[0].strip()
        for field in CASE_REQUIRED_FIELDS:
            if f"**{field}:**" not in block:
                report.add("Test cases", f"{cid}: missing '{field}' field")
        has_steps = re.search(r"^\|\s*Step\s*\|", block, re.MULTILINE)
        derived = re.search(r"identical to\s+[A-Z][A-Z0-9]*-TC-\d+", block, re.I)
        if not has_steps and not derived:
            report.add("Test cases",
                       f"{cid}: no step table and no base-case reference")
        if derived:
            base = re.search(r"identical to\s+([A-Z][A-Z0-9]*-TC-\d+)",
                             block, re.I).group(1)
            if base not in heading_ids:
                report.add("Test cases",
                           f"{cid}: references base case {base}, which is not defined")

    if not re.search(r"coverage matrix", text, re.IGNORECASE):
        report.add("Test cases", "No coverage matrix section found")
    if not re.search(r"execution tracking", text, re.IGNORECASE):
        report.add("Test cases", "No execution tracking table found")

    tracked = set(re.findall(r"^\|\s*([A-Z][A-Z0-9]*-TC-\d+)\s*\|",
                             text, re.MULTILINE))
    defined = set(heading_ids)
    untracked = defined - tracked
    if untracked and tracked:
        report.add("Test cases",
                   f"{len(untracked)} case(s) missing from tracking/summary tables: "
                   f"{', '.join(sorted(untracked)[:8])}"
                   f"{' ...' if len(untracked) > 8 else ''}")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("path")
    ap.add_argument("--type", choices=["plan", "cases"], default="plan")
    ap.add_argument("--json", action="store_true", help="emit JSON")
    args = ap.parse_args()

    try:
        text = read(args.path)
    except OSError as e:
        print(f"Cannot read {args.path}: {e}", file=sys.stderr)
        return 2

    raw_lines = text.split("\n")
    lines = strip_code_fences(raw_lines)
    headings = find_headings(lines)
    report = Report()

    if args.type == "plan":
        check_sections(headings, report)
        check_toc(lines, headings, report)
        check_reference_ids(lines, report)
        check_glossary(lines, headings, report)
    else:
        check_cases(text, lines, report)

    check_tables(lines, report)
    check_tbds(lines, headings, report)
    check_placeholders(lines, report)

    if args.json:
        print(json.dumps({
            "file": args.path,
            "type": args.type,
            "finding_count": report.count(),
            "findings": report.sections,
        }, indent=2))
        return 0

    print(f"\nVerification: {args.path}  (type: {args.type})")
    print("=" * 62)
    if not report.sections:
        print("\nNo mechanical findings.")
    else:
        for section, items in report.sections.items():
            print(f"\n{section}  ({len(items)})")
            print("-" * 62)
            for item in items:
                print(f"  - {item}")

    print("\n" + "=" * 62)
    print(f"{report.count()} finding(s). These are signals, not verdicts —")
    print("some may be faithful to the source document.")
    print("\nStill required (not scriptable): source-fidelity, cross-section")
    print("consistency, scope-coverage, open-items, and boilerplate-drift passes.")
    print("See references/verification-checklist.md\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
