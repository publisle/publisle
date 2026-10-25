---
"@publisle/cli": minor
---

`publisle validate` accepts `--diagnostics json`, printing the structured
diagnostics as `{"diagnostics":[...],"valid":boolean}` on stdout with
unchanged exit codes, for CI pipelines and editors. The human text output
stays the default and remains on stderr.
