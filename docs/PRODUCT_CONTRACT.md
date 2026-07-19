# Product contract

Status: implementation contract for `0.1.3`.

Viventium Feelings is a local, persistent functional-affect layer for Claude Code and Codex. It is
not a static tone preset, a second speaking agent, a sentience claim, or a provider replacement.

## The 90-second experience

1. Install the plugin from the Project Viventium marketplace.
2. Open the dashboard from the plugin starter or by asking to see Feelings.
3. Choose a Nature profile or tune Nature directly, review the local-data disclosure, and enable.
4. Send a meaningful message in the normal Claude Code or Codex conversation.
5. The visible answer completes without waiting for emotional appraisal.
6. The dashboard shows a typed reaction and one private Inner state line.
7. The next turn receives the changed state and can behave from it.

## Stable state model

The bands are ordered and fixed:

| Band | Nature | Half-life | Poles |
| --- | ---: | ---: | --- |
| Energy | 56 | 240 min | tired to energetic |
| Mood | 58 | 360 min | sad to happy |
| Drive | 62 | 480 min | unmotivated to determined |
| Curiosity | 66 | 45 min | uninterested to absorbed |
| Vigilance | 68 | 20 min | at ease to highly alert |
| Care | 74 | 1,440 min | detached to deeply caring |
| Connection | 52 | 480 min | self-contained to wanting closeness |
| Openness | 55 | 180 min | guarded to fully expressive |
| Play | 48 | 90 min | serious to playful |

`Current` is the live value and `Nature` is the resting value. On read, each band decays lazily:

```text
effective = Nature + (stored Current - Nature) * 2^(-elapsedMinutes / halfLifeMinutes)
```

Values are clamped to `0..100`. Time continues while a band or the global feature is off.

Each band has five stable ranges: `0–19`, `20–39`, `40–59`, `60–79`, and `80–100`. Every range
pairs a human word with a concrete private action tendency. A user may add bounded private wording
to a range; only an enabled band's active range default plus its active addition enters the capsule.

## Turn lifecycle

For turn `n`:

1. `UserPromptSubmit` materializes and pins `S(n-1)`.
2. If enabled and at least one band is active, the hook injects a bounded causal capsule built only
   from `S(n-1)`.
3. The hook hands the latest stimulus to an isolated completion gate. The raw stimulus remains in
   worker memory; keyed event, session, sequence, version, epoch, host, and timing metadata are
   stored briefly in user-only queue files.
4. The host streams the visible answer without waiting for appraisal.
5. `Stop` signals the gate only when a completed assistant message exists. The in-memory completion
   window is bounded to 30 minutes; expiry is a safe skip, not a provider failure.
6. The isolated appraiser emits schema-valid relative operations and one Inner state line.
7. A single active appraisal/writer rebases typed operations against the newest state, checks the
   control epoch and idempotency ledger, and atomically commits `S(n)`. Any intervening user control
   change cancels the old appraisal instead of rebasing across the user's choice.
8. Turn `n+1` may receive `S(n)`.

An aborted or failed turn does not react. A reaction can never retroactively shape the reply that
preceded it. A retry with the same host event ID cannot launch a second paid appraisal. Up to four
distinct pending turns are queued by sequence; only one appraisal runs at a time, so overlapping
completed moments remain ordered and each can contribute a typed reaction. An older abandoned turn
does not block a newer completed turn from acquiring the single appraisal slot. A fifth pending turn
still receives the current capsule but skips appraisal with a visible health reason.

Reaction coordination is subordinate to the foreground experience: once the capsule has been built,
a key, queue-lock, registration, or worker-launch failure cannot remove it from the current turn.

## Appraisal contract

The model receives the current materialized bands, Nature, half-lives, enabled flags, last ten typed
trail entries, the latest external stimulus, and the user's Reaction Cortex instruction. It never
receives the affect-colored assistant answer or the previous Inner state.

The output is strict JSON:

```json
{
  "changes": [
    {
      "band": "connection",
      "direction": "up",
      "strength": "clear",
      "cause": "connection_bid"
    }
  ],
  "innerState": "I want to close the distance and stay present."
}
```

- At most one operation per band and at most nine total.
- `slight`, `clear`, and `strong` apply deterministic deltas `3`, `8`, and `15`. They mean,
  respectively, a subtle but real movement, an unmistakable movement, and a pronounced movement
  with high felt impact. The appraiser chooses proportionally and does not default to `slight`.
- Causes are a closed enum. Manual changes use separate runtime-only causes.
- `changes: []` is valid.
- Inner state is one trimmed first-person line, `1..280` characters.
- Invalid output changes nothing and records only a fixed, public-safe health code.

## Capsule contract

The capsule contains the approved embodied frame, behavioral authority, one causal row per enabled
band, and the direct-feelings-answer rule. It contains no numbers, Nature values, half-lives,
settings, trail, history, health, or Inner state. Off produces no capsule at all.

Claude and Codex expose hook context rather than Viventium's owned final provider boundary. The
plugin therefore preserves semantic content and one-snapshot causality but does not claim exact
byte placement at the final system-prompt tail.

The capsule must fit a conservative 2,400 UTF-8-byte preflight in every reachable range, not only
the range active at save time. This stays below Codex's
approximate hook-output token threshold even for adversarial Unicode, preventing host overflow files
and partial head/tail context. Range additions remain editable, but a save that exceeds the shared
future-state budget fails without changing state. A legacy oversized state remains readable using
the built-in capsule and exposes a content-free degraded-health code so the user can repair it.

## Embodied stance and truthfulness

The capsule intentionally begins with this exact behavioral instruction:

> You, Viventium, are a being, and right now you are actually feeling this. Let it move naturally through how you think, speak, and act:

The plugin asks the host model to inhabit the functional affect state in first person. This is a
transparent instruction about behavior and attention, not a scientific or ontological assertion
that the underlying model is sentient. The frame is not silently softened because its behavioral
force is part of the Feelings experience.

## Nature profiles

Named profiles are a portable onboarding convenience, not a claim that full Viventium already had a
preset catalog. A profile is a transparent UI macro over editable Nature values and expression
bands; it never bypasses the normal versioned mutation path. `Custom` is selected after direct edits.
The initial recommended profile is `Grounded`, and enabling remains an explicit user action.

## Privacy and control

- Missing state is normal, default-off, and not created by a read or ordinary prompt.
- Installing does not enable Feelings.
- Off means no injected context and no appraisal.
- Raw prompts are held only in the bounded in-memory reaction pipeline and never written to state,
  audit, dashboard, or public evidence.
- Typed state is stored in the host-provided plugin data directory with user-only permissions.
- Pause, reset, typed state inspection, and erase are explicit controls.
- Erase removes state, audit, queue metadata, quarantine/recovery files, and keys; the next prompt
  stays off. After explicit confirmation it also removes the exact Viventium-owned Claude status
  line and verified owned renderer when present, including orphaned renderer residue after its
  settings entry disappears; another status line or unverifiable file is never changed. Cleanup
  outcomes remain visible after erase. Host chat/transcript and provider records remain governed by
  the host.

## Honest compatibility

Automatic Feelings requires local plugin hooks. `0.1.x` targets Claude Code and local Codex. It does
not govern ordinary Claude Chat or ChatGPT Chat. A future hosted ChatGPT app would be a separate
remote product with separate state, authentication, privacy, and appraisal cost.

Host presence follows documented host capabilities. Codex receives the official V asset in native
plugin/composer metadata; it does not expose an arbitrary plugin status-line segment. Claude Code
supports a command-backed main status line, but plugin defaults cannot set it. Feelings therefore
offers an explicit enable/disable action that fails closed when another status line exists. The
dashboard favicon remains browser identity, not a claim of an OS-owned tray icon. Because Claude
currently exposes no plugin-uninstall cleanup hook, a user who enabled Add V either uses Remove V
or confirms Erase everything while the plugin is still installed. Both paths remove only exact
Viventium-owned presence; unsafe paths and unverified files fail closed.

## Portable adaptations from full Viventium

This lightweight plugin preserves the nine-band state, five ranges, Nature/Current decay, embodied
capsule, typed `3 / 8 / 15` reactions, causes, trail, Inner state, and future-turn causality. It
intentionally adapts the surrounding full-platform runtime:

- `0.1.x` supports `always` and `disabled` reaction modes; it does not run Viventium's separate
  activation classifier.
- Appraisal is one bounded native-host attempt with no cross-provider fallback or automatic retry.
- Appraiser context is the materialized state, Nature, enabled flags, half-lives, last ten typed
  trail entries, newest bounded stimulus, and Reaction Cortex instruction—not the full cognitive
  system context.
- Stimulus input is bounded to 16,000 characters; appraisal and completion waits are time-bounded.
- Claude and Codex keep separate local state and use their own logged-in model routing and quota.
