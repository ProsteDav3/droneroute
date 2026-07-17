## Summary

Hide the sidebar for a fullscreen map view — useful for presenting a mission to a client or just getting more screen space while planning.

## Changes

- New collapse icon button in the sidebar header, next to the help icon.
- **Tab** shortcut toggles the sidebar — only handled when nothing is focused (tag is null/BODY), so it doesn't hijack normal Tab-key focus navigation through buttons, links, and form fields elsewhere in the app.
- A small floating button appears in the map's top-left corner while the sidebar is hidden, to bring it back with a click instead of only via the shortcut.
- Purely local UI state (not persisted) — resets to visible on reload, matching how other transient view toggles in the app behave.
