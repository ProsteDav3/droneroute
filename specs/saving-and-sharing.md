# Saving and sharing

Save your missions to your account and share them with others via a link.

## What you can do

- **Save** a mission so you can come back to it later.
- **Load** any of your saved missions from the routes page.
- **Duplicate** a saved mission as an independent copy — useful for a recurring
  inspection (e.g. a monthly FVE thermography flight or a periodic facade
  check) where you want to reuse the exact same flight plan for the next
  visit while keeping the original as its own separate record.
- **Organize by client/project**: tag a mission with a client or project name, and filter your saved missions by it on the routes page — useful once you're managing flights for several different clients or orders.
- **Organize into folders**: assign a mission to a free-text folder (e.g. "2026
  inspections"), then filter the routes page down to just that folder with a
  dropdown.
- **Search** your saved missions by name from the routes page.
- **Browse version history**: every save keeps a snapshot (the most recent 20
  per mission), so you can see when a mission was last changed and restore an
  earlier version if a later edit turns out to be wrong.
- **Delete** missions you no longer need.
- **Share** a mission by generating a read-only link that anyone can open — no account required.
- **Revoke** a shared link at any time, immediately making it inaccessible.
- Visitors who open a shared link can:
  - View the mission details (drone, waypoint count, distance, altitude, estimated time).
  - Open the mission in the editor.
  - Clone the mission to their own account.
  - Export the mission as a KMZ file.
  - Leave a comment (just a name and a message — no account required).
- **Embed** a shared mission's map on another website via an `<iframe>` — a
  minimal, read-only view with just the map and flight path, no editor chrome.

## How it works

1. As soon as you place the first waypoint or point of interest, the mission
   is automatically named after that location's address (e.g. "Praha 4,
   Podjavorinské"), so you rarely need to type a name yourself. Rename it any
   time — an automatic name is only ever applied once, to a mission that
   hasn't been renamed yet.
2. After planning a mission, click **Save** to persist it under that name (or
   whatever you've renamed it to). Every save also records a version snapshot.
3. To find it later, go to the routes page where all your saved missions are listed.
4. To share, open a saved mission and click the share button. Copy the generated link and send it to anyone.
5. To duplicate, click the copy icon on a saved mission's card. A new mission
   is created immediately, named "\<original name\> (kopie)", with the exact
   same waypoints, POIs, obstacles, buildings, and settings — the original is
   left untouched.
6. To organize by client/project, type a client or project name into the
   "Klient / zakázka" field under the mission name in the editor, then save.
   The routes page shows this on each mission's card, and a filter box
   appears above the mission grid (once at least one saved mission has a
   client set) to narrow the list down to a specific client.
7. To organize into folders, click the folder icon on a saved mission's card
   and type a folder name (leave it blank to remove the mission from its
   folder). Once at least one mission has a folder, a "folder" dropdown
   appears above the mission grid to filter down to it.
8. To search, type into the search box above the mission grid — it matches
   anywhere in the mission's name.
9. To view a mission's version history, click the history icon on its card.
   Each entry shows when that snapshot was saved; click "Restore" on any
   older entry to bring the mission's content back to that point (restoring
   is itself recorded as a new version, so nothing is ever lost — you can
   always restore forward again).
10. To leave a comment on a shared mission, scroll to the bottom of the
    shared page, type your name and a message, and submit — no account
    needed. Comments are visible to anyone who opens the link.
11. To embed a shared mission elsewhere, use its share token in an embed URL
    (`/embed/<token>`) inside an `<iframe>` on your own site.

## Good to know

- You need an account to save missions. Without one, you can still plan flights but they won't persist.
- Shared links are read-only — viewers cannot modify your original mission.
- Duplicating never carries over the original's share link, comments, or
  version history — the copy starts unshared, with a blank history. Duplicating does carry over the original's client/project and folder tags.
- The client/project field is entirely free text — there's no fixed list of clients to choose from, and the filter matches any part of what you type.
- A mission belongs to at most one folder at a time — folders are a flat, free-text tag, not a nested tree.
- Version history keeps only the most recent 20 snapshots per mission; older ones are dropped automatically as new saves come in.
- Comments are anonymous (just a display name, not an account) and are rate-limited to deter spam.
- Sharing, comments, and the embed widget are all available in cloud mode. Self-hosted installations may not include these features.
