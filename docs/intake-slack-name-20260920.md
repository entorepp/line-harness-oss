# Flat Travel intake Slack customer name, 2026-09-20

Owner requested removal of the final secure-traveller-details sentence in the contact handoff and inclusion of customer name in the existing staff Slack intake notification. This supports the September lead-to-operations handoff milestone.

Problem: staff must open the case to identify an enquiry. Completion: Slack carries submitted name, exact FT/FTQ reference and the existing case link; contact handoff retains its request notice and ID without the unwanted sentence.

Benefit: quicker initial review. Counterpoint: names become visible to existing Slack channel members. Scope resolution: allow the submitted name in staff Slack only; keep sensitive profile fields encrypted in TravelWorker and D1 receipt metadata/name-free body unchanged. No historic inference/backfill or customer messages. The existing consent validation remains mandatory.

Validation: route mocks prove name in Slack, no name in persisted receipt, unchanged profile redaction, duplicate suppression and origin/consent checks; special-character escaping and missing/legacy names covered. Site handoff checked for Journey and Tailor-Made across WhatsApp and email. TypeScript and site dry-run passed. Final self-review approved the bounded code change; deployment and live Slack receipt remain separate evidence.
