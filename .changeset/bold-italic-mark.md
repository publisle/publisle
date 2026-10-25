---
"@publisle/research": patch
"@publisle/template-sdk": patch
---

Nested strong and emphasis now project to a combined `bold-italic` mark
instead of collapsing to the outer wrapper, and the pinned font manifest
registers NotoSerif-BoldItalic under that role, so `***bold italic***`
renders with the bold-italic face in native exports (gap 14). The
template-sdk inline mark union gains the `bold-italic` value.
