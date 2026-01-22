# ⚠️ INSTALLATION - Tor Browser Extension

## Quick Install (RECOMMENDED):

1. **Download the repository** as ZIP from GitHub
2. **Extract the ZIP file**
3. **Open Tor Browser**
4. **Navigate to:** `about:debugging`
5. **Click:** "This Firefox" or "This Tor Browser"
6. **Click:** "Load Temporary Add-on..."
7. **Select:** `manifest.json` from the extracted files
8. **Done!** Extension loads immediately

**Note:** Extension will be removed when you restart Tor Browser. Just reload it the same way.

---

## Why Not .XPI Double-Click?

Tor Browser blocks unsigned extensions by default for security. This is normal and expected.

**The about:debugging method bypasses this restriction** and allows the extension to load immediately.

---

## Permanent Installation (Advanced):

If you want the extension to survive browser restarts:

1. Go to: `about:config`
2. Accept the risk warning
3. Search: `xpinstall.signatures.required`
4. Double-click to change to: `false`
5. Go to: `about:addons`
6. Click gear icon (⚙️)
7. Click "Install Add-on From File..."
8. Select the .xpi file
9. After installing, change `xpinstall.signatures.required` back to `true`

The extension will now remain installed permanently.

---

## Usage:

1. Navigate to any Tor onion site with files
2. Click the extension icon
3. Paste URL or click "Use current page"
4. Click "Start recursive scan"
5. Everything downloads automatically

**Features:**
- ✅ Recursive directory scanning
- ✅ Auto-resume interrupted downloads
- ✅ Retry failed files (up to 5 times)
- ✅ Speed control (1-8 concurrent)
- ✅ File filtering (extensions, size, patterns)
- ✅ Pause/resume queue
- ✅ Progress tracking
