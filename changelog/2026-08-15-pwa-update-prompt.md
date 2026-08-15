## Summary

Tell the user when a new version of the app has been deployed and offer a one-click reload, instead of silently keeping the old app shell in the tab.

## Changes

- The service worker registration now handles `onNeedRefresh`: a persistent toast announces the new version with an "Obnovit" action that activates the waiting worker and reloads. Previously the new deploy was downloaded in the background but only took over on the next real page load — and while any tab still held the old worker, even a reload kept serving the old shell. A user planned and flew missions for hours against a panel that no longer matched the deployed app (fields they'd been told existed weren't there). The draft autosave in localStorage means nothing in progress is lost by reloading.
