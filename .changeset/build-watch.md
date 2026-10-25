---
"@publisle/cli": minor
---

`publisle build --watch` keeps running and rebuilds when the source or
host config changes, debouncing by 150 ms. Watch rebuilds stage a sibling
output directory and rename it over the previous output, so readers never
see a partial build. Requires an embedding host that supplies a
cancellation signal.
