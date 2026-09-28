# Creative attribution within the acquisition window

The existing content column stores a validated UTM content label. A new tagged arrival now compares source, medium, campaign and content before reusing a visit. A different creative therefore starts a new anonymous acquisition rather than merging with the earlier ad's actions. Untagged internal navigation retains its original visit. Historical rows remain immutable, and the QA marker remains inherited.

The user requested this for Meta creative comparison. It supports overseas lead measurement. Counts remain acquisitions, not unique people. Privacy validation is unchanged: use short non-personal static labels, not names, phone-like numeric identifiers or unresolved dynamic placeholders. Ad links must supply the label; missing past labels cannot be reconstructed.

Validation is `node scripts/test-acquisition-funnel.mjs` and `node scripts/test-acquisition-actions.mjs`. The Forms Studio generated source is synchronized for canonical consistency; this change requires only the separately guarded public-site release, not a Forms Studio or messaging Worker deployment.

Primary-agent source self-review approved on 2026-09-28 after both acquisition suites passed and generated-source synchronization was checked. The public-site frozen copy is byte-identical excluding its TypeScript directive.
