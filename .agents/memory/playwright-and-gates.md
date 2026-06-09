---
name: Playwright and long-running gates in this container
description: Why bundled Chromium fails to launch here, how to point Playwright at the Replit Chromium, and why detached background gate runs die.
---

# Playwright & long gates in this Replit container

**Bundled Chromium won't launch.** The ms-playwright cached `chrome-headless-shell`
exits 127 with `error while loading shared libraries: libglib-2.0.so.0: cannot open
shared object file`. The NixOS container lacks the libs that binary expects.

**Fix:** point Playwright at the Replit-provided Chromium and disable the sandbox:
- env `REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE` holds the working executable path.
- In a playwright config, set `use.launchOptions.executablePath` from that env var
  (conditionally, so CI without the var is unaffected) and `args: ["--no-sandbox"]`.
- Also set the html reporter `open: "never"`, else the run **hangs** serving the report
  on `localhost:9323` and never exits (looks like RUNNING forever).

**Long gates can't be backgrounded from bash.** `nohup ... & disown` processes are
killed across separate bash tool calls, and a single inline run of `npm run check` /
`npm run test` / `npm run test:smoke` each exceeds the 120s bash timeout.

**Use the validation skill runner** (`setValidationCommand` + `startValidationRun` via
the code_execution sandbox). It is managed and survives across calls; poll with
`getValidationRuns()` (the `startValidationRun` callback itself caps at ~600s and may
restart the sandbox — that's fine, just poll afterwards). `npm run check` ≈ 100s,
`npm run test` ≈ 110s; smoke is much longer because it boots the app + captures
video/trace on failures.

**Why:** these are the two recurring reasons gates appear to "fail" or "hang" here that
have nothing to do with the application code.
