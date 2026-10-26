---
"@publisle/research": patch
---

Pin the native PDF compiler to 0.6.2 on all five platforms, including heading
bookmarks, authored list and table structure, front-matter dates, framed code
blocks and corrected continuation spacing. Keep the hosted worker runtime on
the same exact native version.

Normalize unspecified Markdown table columns to explicit left alignment before
sending native input, preserving authored center and right alignment.
