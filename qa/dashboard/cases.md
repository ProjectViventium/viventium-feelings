# Dashboard acceptance cases

| ID | User action | Expected result | Forbidden result |
| --- | --- | --- | --- |
| DSH-001 | Open tokenized local URL | Nine ordered lanes, Inner state, health, profile, and live timestamp are visible | Blank state, external asset, token in visible history |
| DSH-002 | Toggle off then refresh | Off persists; context/appraisal controls show paused | Re-enabled on read or refresh |
| DSH-003 | Resume | On persists and rails remain readable | State reset or trail loss |
| DSH-004 | Open a band, tune Current/Nature/half-life/enabled and five optional range additions, save | One atomic versioned change appears immediately; profile becomes Custom | Partial range save, stale Inner state, prompt text persisted |
| DSH-005 | Apply Warm profile | Consequence confirmation appears; all Nature and Current values change | Apply without confirmation |
| DSH-006 | Edit Reaction Cortex instruction | Count and saved value persist after refresh | More than 4,000 chars or unsafe HTML |
| DSH-007 | Reset | Confirmation appears; Current returns to Nature; trail remains | Nature changes or trail erased |
| DSH-008 | Erase | Destructive confirmation; all local state/key/audit/jobs disappear; next read is off | State silently recreated or enabled |
| DSH-009 | Concurrent dashboard write | First write wins; stale write gets conflict and refresh guidance | Last-write-wins data loss |
| DSH-010 | API without token / wrong Origin / wrong Host | `401` / `403` / `421`; no state body | CORS access or token bypass |
| DSH-011 | Navigate only by keyboard | Logical focus, visible focus ring, operable dialogs and sliders | Focus trap escape or unlabeled action |
| DSH-012 | 320, 768, 1024, 1440 px | No horizontal loss; primary values and controls remain usable | Clipped actions or overlapping text |
| DSH-013 | Reduced motion | Stagger, pulses, and animated transitions collapse | forced motion |
| DSH-014 | Network interruption | Visible connection status and recovery | blank page or repeated error spam |
| DSH-015 | Inspect console/network | Zero console errors/warnings; only same-origin local requests | telemetry or external network request |
| DSH-016 | Open a newly installed, never-enabled profile | Disclosure explains local state, host processing, quota, and provider retention before any enable action | silent enable, state creation on read, or hidden processing disclosure |
| DSH-017 | Health changes between two degraded causes without a state version change | Polling replaces sign-in guidance with usage-limit guidance immediately | stale cause from the prior degraded reaction |
| DSH-018 | Send numeric strings, null Current, truthy reset flags, or nested range objects to mutation APIs | `422` and no state creation or coercion | silent zero, truthy action, or `500` |
