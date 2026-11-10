# Program templates

Column sets for the documents that have no skill of their own. Fill only from cited sources; an unknown value is `TBC`, never a guess.

## Program card (stage 0, one page)
Program name · environments in order · key dates and holidays · known absences · roles · glossary location · where sources live · who confirms primary documents.

## Decision log
`id | decision | date | source | roles affected | status | supersedes`
A decision replaced by a newer one gets status `superseded` and a pointer; the row is never deleted.

## Risk register
`id | risk or open item | impact | owner role | mitigation | related dates | status | source`

## Workaround log
`id | what could not be tested | workaround | environment | as-of date | retired-on date | source`
When a workaround is retired, add a dated line. Never overwrite history.

## Evidence pack (one per test item)
`specification expectation | system setup responses | screenshots per platform and language | result | tester role | date`

## Sign-off matrix
`test type | environment | signing role | date | evidence link | exceptions`
Left blank until a person signs.

## Status update
`period | done | in progress | blocked (and on whom) | next | dates at risk | decisions needed`
