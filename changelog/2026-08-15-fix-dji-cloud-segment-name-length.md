## Summary

Fix "Nahrát segmenty do DJI Cloud" failing outright for any mission whose name is longer than about 50 characters — including every mission auto-named from a street address. Uploading the same route as a single wayline worked, which made the failure look arbitrary.

## Changes

- Cap wayline names at 64 characters — the width of the DJI Cloud platform's `wayline_file.name` column. The platform does not truncate an over-long name; its `INSERT` fails (`MysqlDataTruncation: Data too long for column 'name'`) and the upload is rejected. Segment uploads tripped this because each leg appends a `-seg-N-of-M` suffix to the mission name, pushing it past the limit, and the first failing leg aborts the whole upload.
- Shorten over-long names from the middle rather than the end, so the trailing discriminator survives — without it every segment of a long-named mission would collapse onto one identical name.
- Re-fit the duplicate-name fallback as well: it appends a timestamp, so it could exceed the limit even when the original name did not, leaving the retry path unable to recover.
