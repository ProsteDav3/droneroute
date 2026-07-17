## Summary

Copy a waypoint's actions and paste them onto another waypoint (or a whole bulk selection) instead of rebuilding the same action sequence by hand at every point.

## Changes

- New `store/actionClipboardStore.ts`: session-only clipboard for a copied waypoint's actions, plus `cloneActionsForPaste` — deep-clones actions with a fresh, sequential `actionId` sequence per paste target so pasted actions never share object identity or DJI action ids across waypoints.
- New copy/paste icon buttons next to the "Akce" heading in a waypoint's editor (`ActionEditor`).
- New `pasteActionsToSelected` mission-store action + "Vložit akce" button in the bulk-edit toolbar, pasting the same copied actions onto every currently-selected waypoint in one undo-history entry.
