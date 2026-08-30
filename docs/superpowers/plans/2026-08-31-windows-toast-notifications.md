# Windows Toast Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace modal message boxes with registered, non-modal Windows toast notifications for Reminder Desk.

**Architecture:** A Node identity helper idempotently invokes a PowerShell registration script that creates a per-user Start-menu shortcut with AUMID `ReminderDesk.Local`. The existing alert interface submits XML-safe `ToastGeneric` content through Windows Runtime and waits only for the short submission process, never for user interaction.

**Tech Stack:** Node.js 24, CommonJS, Windows PowerShell 5.1, Windows Shell COM, Windows Runtime toast APIs, built-in `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-31-windows-toast-notifications-design.md`

## Global Constraints

- Use the stable application identity `ReminderDesk.Local`.
- Register only in the current user's Start menu and require no administrator access.
- Add no npm, PowerShell-module, or network dependency.
- Never interpolate reminder text into executable PowerShell source or command arguments.
- Never fall back to a modal message box.
- Registration failure must not stop the reminder server.
- The existing `showWindowsPopup` export remains available for internal compatibility.
- This workspace is not a Git repository, so commit steps are omitted.

---

### Task 1: Per-user Windows notification identity

**Files:**
- Create: `src/notification-identity.js`
- Create: `scripts/register-notification-identity.ps1`
- Create: `test/notification-identity.test.js`

**Interfaces:**
- Consumes: `ensureNotificationIdentity({ appData, projectRoot, execPath, access, spawn })`.
- Produces: `{ created: boolean, shortcutPath: string }` after an existing shortcut is found or registration exits successfully.

- [ ] **Step 1: Write failing identity-orchestration tests**

Use injected `access` and `spawn` boundaries. Test that an existing shortcut returns `created: false` without spawning; a missing shortcut launches exactly one hidden `powershell.exe` process; paths are absolute; the arguments include `-AppId`, `ReminderDesk.Local`, `-ShortcutPath`, `-TargetPath`, `-EntryPath`, and `-WorkingDirectory`; exit code zero returns `created: true`; and spawn/non-zero exit errors reject.

```js
const result = await ensureNotificationIdentity({
  appData: 'C:\\Users\\Me\\AppData\\Roaming',
  projectRoot: 'C:\\ReminderDesk',
  execPath: 'C:\\node\\node.exe',
  access: async () => { const error = new Error('missing'); error.code = 'ENOENT'; throw error; },
  spawn: fakeSuccessfulSpawn,
});
assert.equal(result.created, true);
assert.equal(result.shortcutPath, 'C:\\Users\\Me\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Reminder Desk.lnk');
```

- [ ] **Step 2: Run the identity tests and verify RED**

Run: `node --test test/notification-identity.test.js`

Expected: FAIL because `src/notification-identity.js` does not exist.

- [ ] **Step 3: Implement the Node identity helper**

Build the shortcut path with `path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Reminder Desk.lnk')`. Resolve the registration script and `src/index.js` to absolute paths. If `access(shortcutPath)` succeeds, return without spawning. If it fails with `ENOENT`, spawn:

```js
spawn('powershell.exe', [
  '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
  '-File', registrationScript,
  '-ShortcutPath', shortcutPath,
  '-TargetPath', execPath,
  '-EntryPath', entryPath,
  '-WorkingDirectory', projectRoot,
  '-AppId', 'ReminderDesk.Local',
], { shell: false, windowsHide: true, stdio: 'ignore' });
```

Resolve only on exit code zero and reject launch errors or non-zero exits. Do not treat access errors other than `ENOENT` as absence.

- [ ] **Step 4: Implement the PowerShell registration script**

Accept mandatory string parameters for the five values above. Create the shortcut directory, then use `Add-Type` with inline C# COM declarations for:

```csharp
[ComImport, Guid("00021401-0000-0000-C000-000000000046")]
internal class ShellLink { }

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
internal interface IShellLinkW {
    void GetPath(IntPtr file, int maxPath, IntPtr data, uint flags);
    void GetIDList(out IntPtr idList);
    void SetIDList(IntPtr idList);
    void GetDescription(IntPtr name, int maxName);
    void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string name);
    void GetWorkingDirectory(IntPtr directory, int maxPath);
    void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string directory);
    void GetArguments(IntPtr args, int maxPath);
    void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string args);
    void GetHotkey(out short hotkey);
    void SetHotkey(short hotkey);
    void GetShowCmd(out int showCommand);
    void SetShowCmd(int showCommand);
    void GetIconLocation(IntPtr iconPath, int iconPathLength, out int iconIndex);
    void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string iconPath, int iconIndex);
    void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
    void Resolve(IntPtr window, uint flags);
    void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
}
```

Add `IPersistFile`, `IPropertyStore`, `PROPERTYKEY`, and disposable `PROPVARIANT` declarations. Set `System.AppUserModel.ID` using format GUID `9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3` and property ID `5`, call `Commit()`, and persist the link. The shortcut target is `node.exe`; its quoted argument is the absolute `src/index.js`; its working directory is the project root; description is `Local reminder scheduler`.

- [ ] **Step 5: Run identity and full tests**

Run: `npm test`

Expected: all original tests plus identity tests PASS.

---

### Task 2: Native ToastGeneric delivery

**Files:**
- Modify: `src/popup.js`
- Modify: `test/popup.test.js`

**Interfaces:**
- Consumes: `showWindowsPopup(reminder, { spawn })` and `buildToastXml(reminder)`.
- Produces: a native toast submitted with AUMID `ReminderDesk.Local`, resolving when PowerShell exits successfully.

- [ ] **Step 1: Write failing toast-content tests**

Test the pure XML builder with literal special characters:

```js
assert.equal(
  buildToastXml({ title: 'Tea & <water>', message: 'Use "blue" > red' }),
  '<toast><visual><binding template="ToastGeneric"><text>Tea &amp; &lt;water&gt;</text><text>Use &quot;blue&quot; &gt; red</text></binding></visual></toast>',
);
```

Test that an empty message creates one `<text>` element, not an empty second line.

- [ ] **Step 2: Replace message-box process tests with toast-submission tests**

Assert the fixed PowerShell source loads `Windows.UI.Notifications` and reads `REMINDER_TOAST_XML` and `REMINDER_APP_ID` from the environment. Assert the generated XML appears only in `options.env`, `shell` is false, `windowsHide` is true, exit zero resolves, and spawn/non-zero exit errors reject. Remove the test that expects resolution on the `spawn` event because toast submission errors must be observable.

- [ ] **Step 3: Run popup tests and verify RED**

Run: `node --test test/popup.test.js`

Expected: FAIL because `buildToastXml` does not exist and the current script uses WinForms.

- [ ] **Step 4: Implement safe XML generation and toast submission**

Escape `&`, `<`, `>`, `"`, and `'` in that order. Generate `ToastGeneric` XML with title and optional message. Use a fixed PowerShell script:

```powershell
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml($env:REMINDER_TOAST_XML)
$toast = New-Object Windows.UI.Notifications.ToastNotification $xml
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($env:REMINDER_APP_ID)
$notifier.Show($toast)
```

Spawn hidden PowerShell with the fixed script and set `REMINDER_APP_ID: 'ReminderDesk.Local'` and `REMINDER_TOAST_XML: buildToastXml(reminder)` in the environment. Await exit code zero. Delete all WinForms owner/message-box code.

- [ ] **Step 5: Run popup and full tests**

Run: `npm test`

Expected: every test PASS and no test references `System.Windows.Forms` behavior.

---

### Task 3: Startup integration, documentation, and real Windows verification

**Files:**
- Modify: `src/index.js`
- Modify: `test/server.test.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: `ensureNotificationIdentity()` from Task 1.
- Produces: startup that warns on registration failure but continues to serve and schedule reminders.

- [ ] **Step 1: Extract and test startup identity handling**

Export `prepareNotificationIdentity({ ensureIdentity, onWarning })`. Test that success returns the helper result and failure calls `onWarning` with a message containing `Windows notifications are unavailable` while resolving `null` rather than throwing.

```js
const warnings = [];
const result = await prepareNotificationIdentity({
  ensureIdentity: async () => { throw new Error('denied'); },
  onWarning: message => warnings.push(message),
});
assert.equal(result, null);
assert.match(warnings[0], /Windows notifications are unavailable/);
```

- [ ] **Step 2: Run the startup test and verify RED**

Run: `node --test test/server.test.js`

Expected: FAIL because `prepareNotificationIdentity` is not exported.

- [ ] **Step 3: Integrate identity preparation before server startup**

Implement the wrapper and call it at the beginning of `main()` before `createAppServer()`. Registration failure must print the warning and continue. Library-level `createAppServer()` remains side-effect free so automated server tests do not write to the Start menu.

- [ ] **Step 4: Update the README**

Replace modal-dialog language with native Windows toast behavior. Document automatic per-user Start-menu registration, no-admin behavior, Notification Center, no click action, removal/recreation of the shortcut, terminal fallback, and the need to restart an already-running Reminder Desk process after upgrading.

- [ ] **Step 5: Run final automated verification**

Run: `npm test`

Expected: all tests PASS with zero failures.

- [ ] **Step 6: Run real per-user registration and toast verification**

From the user's interactive Windows terminal, stop any old Reminder Desk process and run `npm start`. Confirm `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Reminder Desk.lnk` exists. Create a five-second interval reminder and leave the first toast untouched. Confirm a later toast appears independently, both are visible in Notification Center, the reminder remains Active, and no `powershell.exe` MessageBox process waits for OK.
