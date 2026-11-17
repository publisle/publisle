---
"@publisle/core": patch
"@publisle/adapter-core": patch
"@publisle/playground": patch
---

Keep an empty figure as a placeholder instead of failing the document, and
render a warning in place of an unsafe figure URL. The playground edits list
items, links, and images as fields so inline math and task state stay put.
