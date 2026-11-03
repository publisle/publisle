---
"@publisle/template-sdk": patch
---

Omit an empty LuaLaTeX table caption so a Markdown table no longer prints
"Table 1:". Fit tables with six or more columns inside the column width on
LuaLaTeX and pdfLaTeX with a smaller font, instead of letting wide tables run
past the page.
