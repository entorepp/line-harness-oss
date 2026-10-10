# Survey equipment questions — review draft, 2026-10-10

Problem: capture the customer's need for a hoist handover explanation and a rental sling before equipment arrangements. This supports the lead-engine project's standard handoff and reduced operations work, and the package project's accessible operation checks. It does not change Nika deadlines, capacity or WBS.

Benefit: a conditional question makes the handover preference explicit; rental sling requests now retain known sizing and attachment details. Counterpoint: more questions add burden and a requested service could be confused with confirmed availability. The new explanation question is optional, appears only for hoist users, and explicitly requires provider confirmation. Rental availability, compatibility and charges are confirmed separately.

## Proposed change

- Section 7: optional explanation at delivery/setup, with requested / not requested / discuss choices.
- Q32: explicitly ask whether a rental sling is needed; distinguish own sling, rental request and discussion.
- Q33: show the optional size/type information for both rental and own-sling users.
- Keep Q1–Q53 and the three existing Q32 option values stable. New field Q54 is displayed after Q31 without renumbering other questions. Registration grows from 56 to 57 fields.

## Evidence

- Live pre-change form read on 2026-10-10: active, 56 fields, submitCount 10, updatedAt 2026-10-08T17:58:53.689+09:00; saveToMetadata false; null tag/scenario.
- Static survey contract, equipment serialization/hidden-answer tests, 60 name cases, input validation, protected upload regressions and server draft tests passed.
- Chrome official extension, profile ユーザー 1: local preview displays the conditional questions; explanation and rental choices survive reload through the isolated local draft fixture.
- 390px and desktop visual inspection passed. Mobile document width equals viewport width (390px).
- No production form definition, stored answer, case, message, provider booking, deployment or Nika mutation.

## Open acceptance items

- User wording review: whether 'explanation when the hoist is delivered' means a preference question or published delivery instructions. Current implementation is the preference-question proposal.
- The lightweight questionnaire URL/name is still required. Do not infer the form ID from an older agency or Accessible Japan form.
- Before production: obtain the current exact D1 fields and updated_at, apply only Q32 label plus Q54 using optimistic guards, preserve all other form properties and submissions, and reread both the definition and submission counts/digests. Do not run the broad registration script with --apply.
- Publish through production/liffform-studio and its guarded deployment script after wording review. Verify production asset hashes and customer-visible questions; live response submission/notification is not established by local tests.

Source review: no existing question key or choice value changes; private uploads, consent, draft owner binding and routing are unchanged. New optional choice does not invalidate existing drafts. Pending product wording review and exact lightweight form identity prevent declaring the requested task complete.
