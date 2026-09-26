<!-- Copyright © 2026 Manolo Remiddi · SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0 -->

# Preview changes

## 0.2.12+fukuro (fork)

- Augmentor Voice LAN plugin (`adapters/dsh-voice-lan`, protocol
  `augmentor-voice/1`): DSH host plugin serving native and browser voice
  through the LAN InferenzQuelle (batch STT + TTS over the loopback
  forward). Replaces the unshipped private `dsh-resonant-voice` backend
  and the retired local `:8877` service. Voice preferences moved to local
  `voice_*` keys with legacy migration; `python3-sounddevice` added to the
  desktop package dependencies. The complete-bundle path no longer
  packages the private plugin: `package-complete.py` drops the voice
  tarball/source args and `setup-complete.py` registers the in-repo
  plugin through the product setup instead of the retired provisioning
  flow. The hands-free endpoint detector loads its pinned Silero model
  from `~/.local/share/augmentor/vad/` (legacy path fallback).
- X11 desktop-control backend (`x11-xtest`) for non-KDE sessions: EWMH
  active-window following across multiple monitors, Flameshot/Qt capture,
  XTEST input via python-xlib, in-process Qt consent, independent Stop.
- User-facing UI localized to German across the native app, browser
  extension, Home and mobile surfaces, runtime errors and the prompt
  library service.
- `voice_submit_mode` preference (`auto` | `review`, default `auto`):
  `review` parks the finished transcript in the composer/sidebar input as
  a correctable draft instead of submitting it; `auto` keeps the
  immediate submit. Exposed in the native Voice settings and the
  extension's voice section; the browser lease picks the mode up at
  `voice/start`.

## 0.2.3

- Both UIs can check a supported DSH connection, install Augmentor's owned roles,
  preserve existing profile text and save the shared connection. Customized
  integration files are protected from replacement. DSH retains its model setup.
- Pi and DSH share Linux's consented KDE Wayland desktop executor, including
  screenshot observations, bounded input and an independent Stop control.
- Browser DSH access is restricted to the paired product integration and browser
  conversations; Linux tools and legacy update/configuration endpoints are refused.
- Native Support report export uses a file chooser, private atomic writes and
  preserves existing reports on failure. Maintenance backs up shared harness
  configuration and refuses replacement while the paired DSH integration runs.
- Release checks inspect final packages and extension inventories, source identity,
  native binary hashes, notices and accidental user-state files.

Desktop input is a preview for one-monitor KDE Wayland with accessible controls,
ASCII text and image-capable models. See DESKTOP-CONTROL.md. Beta assignments,
data handling and public distribution limits are documented separately.

## 0.2.2

- Shared optional Hindsight memory, explicit retention, source viewing, fact
  export, deletion and disabled-by-default recall across both UIs and harnesses.
- Browser Pi first-run setup, explicit image-input check, private support-report
  download and metadata-only diagnostic retention.
- Reproducible extension ZIP, stable extension identity and exact release
  compatibility with the installed companion before work starts.

## 0.2.1

- Safe maintenance leases, migration, backups, interrupted configuration,
  upgrade/rollback, removal and reinstall preserving user data.
- Full Plasma Wayland VM acceptance exposed and fixed cold startup; packaged
  shortcut launch/hide/show works after reboot.
- DSH Branch/Edit retains completed tool context and source conversations while
  refusing replay of unknown fork outcomes.

## 0.2.0

- Unified private repository, pinned Pi runtime, shared prompt records and
  clipboard templates, common message actions and replaceable harness adapters.
- Separate Debian runtime/companion and native desktop packages; PySide6/Qt
  migration, notices and guided Pi model connection.

These entries describe preview implementation. PRODUCTIZATION-STATUS.md records
the exact evidence and remaining release gates. Report reproducible issues through
the private repository's Issues page, without credentials or private chat content.
