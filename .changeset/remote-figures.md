---
"@publisle/research": minor
"@publisle/template-sdk": patch
---

Local LaTeX exports accept HTTPS figure URLs at package time with the
hosted service's safety rules: HTTPS-only, content-type allowlist, the
4 MiB image / 16 MiB PDF byte caps, self-contained SVG validation
(checkSvg moved to @publisle/research and re-exported), and sharp
rasterization of remote SVGs to PNG. Non-HTTPS schemes keep rejecting
with clear errors, and local figure files are untouched.
