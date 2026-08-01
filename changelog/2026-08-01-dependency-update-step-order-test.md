### Internal

- Added regression tests for the step ordering inside `dependency-update.yml`. A GitHub Actions step only sees `steps.<id>.outputs.*` from steps that ran before it, so a step gated on an id declared later silently never runs — exactly how "Format with updated dependencies" quietly no-op'd until it was reordered. The tests parse the workflow and fail on any condition that references a later step, so the bug can't return without needing a live Actions run to notice.
