# Test Plan Template — Section Reference

The standard enterprise QE test plan has 15 numbered sections. Emit them in this order every time. Sections marked **boilerplate** carry forward verbatim from the organization's prior plans; sections marked **project** are populated from sources.

---

## Header

Document title, organization name, and the standing scope note:

> **Please Note:** This Test plan includes the scope, approach, resources and schedule of all the testing activities coordinated by [POD]. The plan identifies the features to be tested, the types of testing to be performed, the personnel responsible for testing and signoff, the resources required to complete the testing, dependencies if any and the risks associated with the plan.

## 1. Table of Contents — generated

Nested bullet list mirroring every heading including sub-sections. Regenerate whenever headings change; a TOC that drifts from the body is a guaranteed review finding.

## 2. Project Overview — project

Table: Description, Goal, Version, Prepared by, Revised by, Publish Date.

The **Goal** field is where reviewers spend disproportionate time, because it defines scope in one sentence. Structure it: what functional testing ensures → what it must not impact → what else is validated → under which conditions (languages, placement types, environments).

Version convention: `0.1` initial draft, `0.2` second draft, `1.0` at approval.

**Prepared by** is the author. **Revised by** accumulates everyone who edited. Plan authors do not appear in the Distribution List (2.4) — they're producers, not recipients.

### 2.1. Revision History — project
Version Number | Revision Date | Summary of Changes | Modified by. One row per version, appended never rewritten.

### 2.2. Test Plan Approvals — project
Name | Title | POD / Product Group | Platform | Location of Sign-Off.
Typically Product Owner and Technology Asset Owner. "Location of Sign-Off" points at the email or artifact holding the approval — `TBD` until it exists.

### 2.3. Test Plan Reviewers — project
Name | Title | POD / Product Group | Platform.
Typically Release Train Engineer, Dev Lead, Business Systems Analyst, PG Test Lead. Unfilled roles are `TBA`, not omitted rows — the empty seat is information.

### 2.4. Distribution List — project
Name | Role. Everyone who receives the plan: BSA, Scrum Master, engineers, QE lead. Authors excluded.

## 3. Referenced Documents — project

Application/POD/PG | Document Name | Mandatory | Source / Location Links.
Knowledge Document and Requirements Document are the mandatory two. Link or `TBD` — never a guessed URL.

### 3.1. Overall Test Objectives — boilerplate
~15 standing bullets covering: specification coverage, defect identification, retest to acceptable quality, efficiency within constraints, error-prevention record, cases uploaded to the test management tool before execution, environment readiness, execution trigger conditions, expected-vs-actual validation, status updates, pass/fail determination, defect documentation with screenshots and repro steps, daily project sync, execution until Done per acceptance criteria, QE defect-tracking support.

Organizations often add a sign-off-under-open-defects clause: where defects can't be resolved within the sprint, sign-off is obtained regardless with outstanding items tracked into the next release. Include it when the organization works that way.

### 3.2. Project Specific Test Objectives — project
2–5 bullets specific to this release. Each dimensional variant in scope (languages, placement types) earns its own bullet.

## 4. Project Scope

### 4.1. Impacted Technology/Applications — project
Impacted Applications | Code Changes to Application | QE (Point of Contact) | POD | Platform / PG.

### 4.2. High Level In Scope — project
Platform | Scope | Scope Definition | Platform User Epic | Platform User Stories.

Scope Definition is the analytical core of the plan and the section test cases derive from. For each flow, structure as:

```
[FLOW]-Flow (targeted):
1. Entry Point
   - What initiates the flow, what makes it the primary entry point
   - Which event fires, where it's verified
2. Event Validation on [Page]
   - Navigation to the page
   - Each button, what it signifies, which event fires, where verified
3. Exit Point
   - What serves as primary exit point
```

Precision about *when* an event fires matters more than it looks. "On page load" and "on clicking Start" are different test cases with different failure modes, and reviewers correct this specifically. Where a flow has multiple cancel or decline screens, enumerate them individually — "can be triggered from multiple pages" is not testable.

Dimensional variants (languages, placement types) go in a final row as bullets.

### 4.3. Out of Scope — project
Item No | Out of Scope Features. Standard exclusions: accessibility, performance, multi-browser, anything unmentioned, public sites, beacons, campaign setup/E2E, DEV testing. Add project-specific ones — UI/content verification is a common exclusion when only backend events are validated.

## 5. Testing Milestone — project
Platform | Testing Stage/Environment | Test Set | Start Date | End Date | Owner | Comments.
One row per phase. Unconfirmed dates are `TBD` with the blocker named in Comments.

## 6. Test Types — project
Platform | Description | [environment columns] | [test type columns].
✅/❌ per cell. Confirm regression status with the dev lead rather than assuming — whether a change touches existing flows is a development question.

## 7. Project Escalation Process — boilerplate structure, project names
Platform | issue-category columns | Raised By | 1st Level | 2nd Level.

## 8. Test Entry and Exit Criteria — boilerplate + project additions
Two tables, each Criteria | Evidence.

Standard entry: plan signed off, cases created and reviewed, test set identified, test data requested, resources available, data/environment reviewed, defect process in place, unit testing complete.

Standard exit: results documented, defects logged, evidence reviewed, no outstanding severity 1–2, severity 3–4 reviewed and approved or action-planned, descoped items approved, closure report approved.

Project-specific entry criteria are where release-specific preconditions live — account setup, offer configuration, event names confirmed.

## 9. Test Environment — project
Test Environment Name | Definition and Purpose | Test Set | URL/Links | Availability | Test Data Complexity.

### 9.1. Test Tool — boilerplate
Category | Tool | Purpose. Test Management, Test Artifact Storage, Test Data, Software/automation.

### 9.2. Test Case Management Tool — project
Tool | URL. Points at this release's repository folder. A prior release's URL carried forward unchanged is a common and easily-caught error.

## 10. Test Assumptions, Constraints & Dependencies — boilerplate + project
Reference Id | Type | Description. `A###` assumption, `C###` constraint, `D###` dependency.

Standard assumptions cover unit testing, interface stability, change-request process, documentation timelines, resource availability, outage communication, environment availability.

Project dependencies are the valuable rows. Look for: pending setup, upstream team ownership of adjacent systems, unconfirmed configuration, deployment schedules. A dependency naming another team's ownership of their own application's defects is worth including — it sets expectations about what blocks QE.

Keep IDs unique and sequential.

## 11. Roles and Responsibilities — boilerplate
Test Lead block and POD QE Member block, each with names and standing bullets.

## 12. Testing Risks — boilerplate + project
# | Risk | Type | Likelihood | Impact | Mitigation | Contingency.

8 standard risks: test-activity delays, environment readiness, defect-resolution turnaround, test data quality, development delays, defect-fix SLA, resource availability, scope change.

Project risks come from the transcript's soft spots — pending setup delaying the start date, an adjacent application's defects blocking execution. Phrase as `IF [condition] THEN [consequence] RESULTING IN [impact]`.

Risks and open items are different. A risk is something that might go wrong; an open item is a question needing an answer. "Event names not yet confirmed" is an open item, not a risk — reviewers make this correction.

## 13. Testing Communication Process — boilerplate
ID | Information Communicated | Responsibility | Participants | Method | Frequency.

## 14. Defect Management — boilerplate
Severity definition paragraph, then Defect Severity | When to use? for Critical / High / Medium / Low.

### 14.1. Defect Priority — boilerplate
Same four-level structure for fix ordering.

If the source document numbers this oddly (e.g. `14.1. 15.1.`), preserve it in RECONSTRUCT mode.

## 15. Glossary of Terms — project
Acronym | Definition. Only acronyms actually used in the document. Reviewers remove entries for terms that don't appear — a glossary is a reading aid, not a domain dictionary. Verify each entry's expansion; `SDC` vs `SFDC` type errors get caught.

---

## Open Items (appended, non-standard but valuable)

Item | Owner | Status. Every `TBD` and every "confirm with X" from the review. Not part of the formal template, so flag it as an addition — but it's what makes the plan actionable between drafts.
