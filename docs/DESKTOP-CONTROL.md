<!-- Copyright © 2026 Manolo Remiddi · SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0 -->

# Linux desktop control preview

Pi and DSH use the same per-user desktop executor. It captures a consented screen
and can click, send a short key chord or type up to 256 ASCII characters into an
accessible focused control. The browser role has no desktop input tools.

Two session backends are qualified, each selecting automatically by session
type:

- **KDE Plasma Wayland** (upstream target): Debian 13, one active monitor and a
  model configured for image input. The Augmentor window and independent Stop
  control use XWayland; the tested target application, Kate, uses native
  Wayland. Other Wayland desktops, multiple monitors, password fields and
  non-ASCII typing are not supported on this backend.
- **X11 (`x11-xtest`, fork target)**: tested on Ubuntu/MATE X11 with two
  monitors. The backend follows the active EWMH window and captures whichever
  monitor contains it — see the [X11 backend](#x11-backend-x11-xtest) section
  below. Password fields and non-ASCII typing remain unsupported.

An image-capable chat model is no longer required: `linux_desktop_look`
delegates visual questions to the LAN vision model and returns plain text.
With an image-capable model a `linux_desktop_snapshot` still attaches the
screenshot to the conversation as before — see
[Delegated vision](#delegated-vision-linux_desktop_look) below.

The desktop package supplies the capture/input dependencies.

## Using it

1. Open the intended application and a harmless test document. Enable
   accessibility for that application. An image-capable model is optional:
   `linux_desktop_look` answers visual questions through the LAN vision
   model for any chat model, while `linux_desktop_snapshot` still attaches
   the image directly when the selected model declares image input.
2. Ask Augmentor for a bounded action. The OS opens **Remote control requested**.
   Choose **Share** yourself to allow capture and keyboard/pointer input. If the
   dialog opens behind another window, select it with Alt+Tab. Declining or
   cancelling it leaves sharing closed.
3. Keep the independent **Stop desktop control** button visible. Either that
   button or chat **Stop** closes sharing and releases held keys. A turn ending
   also releases its owned connection; five idle minutes close unused sharing.
4. Inspect the application or saved file to verify the result. Input dispatch
   alone does not prove success. After cancellation, text may be partial; an
   uncertain action must not be replayed automatically.

Each action requires a screenshot with a fresh compositor-owned window identity.
Its target token expires after 30 seconds and is consumed once, including refused
actions. The executor rejects a changed or covered target, changed monitor
geometry, inaccessible keyboard focus and another chat's ownership. These checks
reduce accidental input; they are not an operating-system sandbox.

Screenshots are persisted in a per-user observation store (see below).
With an image-capable model they also go to the selected model and may
remain in the harness conversation history. The executor itself writes no
screenshot file and does not use the clipboard to type. See
DATA-AND-SUPPORT.md for data locations and deletion limits.

## Delegated vision (`linux_desktop_look`)

`linux_desktop_look({question, reuse?})` keeps the screenshot out of the
chat model entirely. The tool captures a fresh consented screenshot (or,
with `reuse:true`, reuses this chat's latest stored observation), persists
it in the observation store, and posts image plus the focused question to
the LAN InferenzQuelle vision endpoint (`127.0.0.1:8012`, OpenAI-compatible
`chat/completions`; the router forwards image payloads to the VLM cascade).
The textual answer returns to the chat model, which then decides the
action — one capture can serve several questions.

The observation store lives at
`$XDG_STATE_HOME/augmentor/desktop-observations/` (override:
`AUGMENTOR_OBSERVATION_DIR`), survives reboots, and records each capture as
`obs-<ISO-timestamp>-<random>.png` plus a JSON sidecar with owner, capture
time, size and the questions asked about it. Stored observations are pruned
oldest-first to roughly 50 MB (`CAP_BYTES`).

The safety contract is unchanged: `look` captures only after OS consent, the
per-chat owner and independent Stop apply, and actions still need a fresh
`snapshot`/`look` observation for their single-use target token.

The Pi development runtime now also offers a [bounded desktop
specialist](DESKTOP-SPECIALIST.md). Its screenshots stay in a separate worker
context and private local evidence files; the coordinator receives a short
structured result. This has different retention behavior from direct desktop
tools. The native executor and its platform limitations remain the same.

## X11 backend (x11-xtest)

On non-Wayland Linux sessions the executor selects `services/desktop/x11.py`
(backend id `x11-xtest`) instead of the KDE portal path. It was tested on
Ubuntu/MATE X11 and keeps the same safety contract: explicit consent before
capture or input, an independent visible Stop control, per-conversation
ownership, consumed-once target tokens and no replay of unknown-outcome
actions.

Differences from the Wayland backend:

- Consent is an in-process Qt dialog; X11 has no portal-mediated consent.
- Capture uses Flameshot when available (`flameshot full -r`) and falls back
  to `QScreen.grabWindow`. Input uses XTEST via python-xlib.
- Multi-monitor sessions are allowed. The backend follows the active EWMH
  window and captures the monitor containing it; a window that cannot be
  resolved blocks the action.
- Typing still targets an AT-SPI accessible focused control and ASCII text.

The same-tool checks (changed/covered target, changed geometry, focus and
ownership) apply unchanged.

## Reproducible evidence

`scripts/vm-desktop-proof.py` drives a disposable full Plasma Wayland VM. It
checks declined consent, Stop during consent, target/owner/replay refusals, actual
Kate Save As contents, and interruption of a long write through the independent
Stop button. `--scale` selects 1, 1.25 or 1.5. By default it runs the installed
executor; `--source` explicitly records candidate source staging instead.

`scripts/vm-desktop-engines-proof.py` uses actual Pi and DSH SDK tools with a
deterministic HTTP model. A private SSH socket forwards only desktop operations
to that VM, while host desktop autostart is disabled. It verifies actual image
bytes reaching the model, exact saved-file text and cancellation. The model
fixture supplies known coordinates; this is not a visual-reasoning benchmark.

The exact tested candidate and scales are recorded in PRODUCTIZATION-STATUS.md.
Independent hardware/users and model quality remain beta gates. The VM uses a
consistent Nehalem CPU model: `release/vm-avx-mask-proof.c` reproduces a masked
AVX2 load fault in QEMU 10.0.11 TCG that also crashed Qt/Breeze. The test avoids
that emulator defect without changing Qt or the user's system.
