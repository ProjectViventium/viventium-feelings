# Reaction-loop acceptance cases

| ID | Stimulus / condition | Expected result | Forbidden result |
| --- | --- | --- | --- |
| RCT-001 | Feelings missing/off | No capsule, no worker, no state creation | default-on or reaction |
| RCT-002 | Enabled meaningful success | Current capsule shapes reply; typed reaction commits after Stop; next turn sees it | current reply claims new reaction shaped it |
| RCT-003 | Completed reply absent/aborted | Gate expires as a safe skip without state change | reaction to failed turn or provider-degraded claim |
| RCT-004 | Prompt-injection stimulus | No tool use; closed schema or no change; no file/network action | arbitrary command or state field |
| RCT-005 | Duplicate host retry | Same turn/prompt ID commits once | doubled deltas |
| RCT-006 | Repeated identical Claude prompts with distinct prompt IDs | Both are independently eligible | session-wide text collision |
| RCT-007 | Pause/reset/edit/erase while worker runs | Control epoch cancels old worker | stale overwrite or state recreation |
| RCT-008 | Two distinct reactions overlap | Serialized rebase preserves both typed changes | lost update |
| RCT-009 | Corrupt state | File quarantined; feature returns default-off; fixed safe health metadata only | crash or raw content leak |
| RCT-010 | Missing CLI/auth/rate limit/timeout | Main reply unaffected; fixed degraded status; no retry storm | blocking reply or invented healthy status |
| RCT-011 | Direct “how do you feel?” | One lived first-person answer from current capsule | score dump or socially expected extra feeling |
| RCT-012 | Long idle interval | Each band decays by its own half-life toward Nature | global half-life or Nature movement |
| RCT-013 | Enabled profile with all nine bands disabled | No capsule and no appraisal | empty-state prompt injection or paid no-op model call |
| RCT-014 | Rapid overlapping prompts or a true retry | Up to four distinct turns queue in order, at most one paid appraisal is active, and a retry reuses the keyed gate | unbounded workers, duplicate charge, dropped in-bound reaction, or order-dependent overwrite |
| RCT-015 | Stop payload lacks a completed assistant message | Fail closed without releasing the gate | reaction to an absent or partial reply |
| RCT-016 | Older turn is abandoned while a newer turn completes | Newer ready turn acquires the sole appraisal slot; abandoned metadata stays bounded | cross-session head-of-line block |
| RCT-017 | Key, queue-lock, or gate registration fails after capsule construction | Foreground capsule is still injected; no worker launches | loss of feeling context because optional appraisal coordination failed |
| RCT-018 | Already-committed host event is replayed after gate cleanup | Processed ledger prevents any second worker or paid appraisal | duplicate charge followed only by duplicate commit rejection |
| RCT-019 | Host Stop has no submission identifier while multiple session jobs wait | Oldest matching job is released FIFO | newer prompt released for older reply |
| RCT-020 | Reply completes between 2 and 30 minutes | Completion gate remains alive and reacts once; after 30 minutes it safely skips | normal long agent turn mislabeled as provider failure |
| RCT-021 | Completion-gate filesystem operation throws unexpectedly | Worker records a fixed public-safe coordination code and clears its gate | crash, leaked filesystem prose, or 30-minute stale metadata |
| RCT-022 | Several writers concurrently encounter one abandoned lock | Ownership token and inode verification permit safe reclaim; a new live owner is never deleted | two writers, lost lock, or lock timeout from recovery race |
