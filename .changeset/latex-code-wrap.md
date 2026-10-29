---
"@publisle/template-sdk": patch
---

Wrap long code lines with the listings package so every token stays inside the
page for LuaLaTeX and pdfLaTeX. Tagged PDF/UA output keeps those listings in
the structure tree. Reject a listing terminator, and keep the pdfLaTeX Unicode
rejection.
