# Windows release smoke test

Use this checklist on both Windows 10 and Windows 11 before publishing the
first Windows release. Record the Verse version, commit SHA, installer name,
SHA-256, Windows build, WebView2 version, machine/VM, tester, and date.

The NSIS installer is intentionally unsigned to keep the project cost-free.
Microsoft Defender SmartScreen can therefore show an unrecognized-app warning.
Only continue after confirming that the file came from the official GitHub
Release and that its SHA-256 matches the accompanying `SHA256SUMS`.

## Integrity and installation

1. Calculate the installer hash:

   ```powershell
   Get-FileHash -Algorithm SHA256 ".\ZYYK Verse_<version>_x64-setup.exe"
   ```

2. Confirm that `Get-AuthenticodeSignature` reports `NotSigned`.
3. Install for the current user without administrator elevation.
4. Open the Start Menu shortcut and confirm that exactly one window starts.
5. Switch the interface between Portuguese and English.

## Vault and persistence

1. Create a vault, folder, and project; edit, save, close, and reopen them.
2. Rename and move projects and folders.
3. Confirm that a stale revision cannot overwrite newer work.
4. Delete a project and confirm that its managed assets are removed.
5. Repeat creation and reopening in a path with spaces, accents, Unicode, and
   a long filename, for example `Músicas\Traduções 日本語`.

## Audio and timeline

For MP3, WAV PCM, FLAC, and OGG/Vorbis, confirm all of the following:

- import into the project's managed assets;
- waveform generation;
- play, pause, resume, and seek;
- playhead synchronization while playing and dragging;
- save, close, reopen, and play again;
- no raw technical error shown as interface copy.

## Translation and export

1. Check dialogs, suggested filenames, filters, fallbacks, and error messages
   in Portuguese and English.
2. Export synchronized cues as SRT, WebVTT, and LRC.
3. Verify UTF-8 text, timestamps, line breaks, and translated content.
4. Export a partially translated project and confirm the omitted-cue warning.

## Upgrade and uninstall

When two consecutive candidates are available:

1. Install the older candidate and create a vault and project.
2. Run the newer installer over the existing installation.
3. Confirm that the application and user data remain accessible.
4. Uninstall through Windows settings.
5. Confirm that application files are removed and user documents remain.

## Approval criterion

Windows support is approved when Windows 10 and Windows 11 complete this
checklist without corruption, data loss, playback failure, or invalid exports.
The SmartScreen warning and `NotSigned` state are expected and are not failures
when the installer origin and SHA-256 have been verified.
