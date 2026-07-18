---
name: security-review
description: Security-focused review of a target project's pending changes — flags only high-confidence, concretely exploitable vulnerabilities (not theoretical/style issues). Use before automation finishes a task that touches auth, input handling, file/shell/network operations, or secrets in a target project, or whenever the user asks for a "security review". Skip for changes with no security-relevant surface (pure UI copy, test-only files, docs).
---
# Security review

Reviews a target project's diff for **newly introduced** vulnerabilities only — not
pre-existing issues, and not this framework's own code (`revab-agents` isn't the target).

## Categories to examine
- **Input validation**: command/SQL/NoSQL/template/XXE injection, path traversal.
- **Auth & authorization**: bypass logic, privilege escalation, session/token handling.
- **Secrets & crypto**: hardcoded credentials, weak algorithms, improper key handling.
- **Unsafe deserialization/execution**: eval-style dynamic code execution, unsafe deserializers.
- **Data exposure**: secrets/PII in logs, debug info left in responses.

## Confidence bar
Only report a finding at >80% confidence of real exploitability. Read the code to determine
exploitability — don't run commands or write files to "test" it live.

**Do not report** (hard exclusions — these generate noise, not signal):
- Denial-of-service / resource-exhaustion / rate-limiting concerns.
- Secrets already secured by another documented process.
- Outdated third-party dependency versions (tracked separately).
- Lack-of-hardening / missing-best-practice findings with no concrete exploit path.
- Findings inside test-only files, or inside documentation/markdown files.
- Memory-safety findings in memory-safe languages (JS/TS included).
- Client-side-only missing auth checks (the backend is responsible for enforcement).

## Output
For each finding: file, line, severity (High/Medium/Low), category, description, a concrete
exploit scenario, and a fix recommendation. Report High and Medium only — when in doubt, drop
it rather than pad the report. If nothing survives the confidence bar, say so explicitly.

## Rules
- Never treat env vars/CLI flags as attacker-controlled in a normal deployment — they're
  trusted inputs here.
- This is a read-only review — no fixes applied. Automation applies any resulting fix and
  re-verifies it (see the `verify` skill) before calling the task done.
