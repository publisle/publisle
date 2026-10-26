"""Independent, bounded built-in numeric/author-date citation formatting.

No JavaScript, network, CSL processor or generated expectations are loaded.
The shared descriptor defines the supported role, input subset and budgets.
"""
import json
from copy import deepcopy
from pathlib import Path
import re

SUBSET = json.loads((Path(__file__).resolve().parents[2] /
                     "packages/contracts/citation-subset.json").read_text(encoding="utf-8"))
WHITESPACE = r"[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]"


def text(value):
    return (isinstance(value, str) and len(value.encode("utf-16-le", errors="surrogatepass")) // 2 <= SUBSET["limits"]["text"]
            and re.search(r"[<>\x00-\x1f\x7f-\x9f\ud800-\udfff]", value) is None)


def matches(pattern, value):
    return re.fullmatch(pattern, value) is not None


def normalize(value):
    return re.sub(WHITESPACE + "+", " ", value).strip(" ")


def portable_citation_limit(document, style, locale):
    if style not in SUBSET["capabilities"]["styles"]:
        return "Only built-in numeric and author-date styles are supported."
    if locale not in SUBSET["capabilities"]["locales"]:
        return "This citation locale is outside the shared subset."
    if (not isinstance(document, dict) or isinstance(document.get("schemaVersion"), bool)
            or document.get("schemaVersion") != 1 or not isinstance(document.get("blocks"), list)
            or len(document["blocks"]) > SUBSET["limits"]["blocks"] or "dependencies" in document):
        return "Expected an unlocked v1 citation document within the shared budget."
    entries, clusters, suppressed = [], 0, set()

    def inline(nodes, depth=0):
        nonlocal clusters
        if not isinstance(nodes, list) or len(nodes) > SUBSET["limits"]["clusters"] or depth > 16:
            return False
        for node in nodes:
            if not isinstance(node, dict) or node.get("type") not in SUBSET["inlineTypes"]:
                return False
            if node["type"] in ("strong", "emphasis", "strikethrough"):
                if not inline(node.get("children"), depth + 1):
                    return False
            elif node["type"] != "citationReference":
                if ((node["type"] in ("text", "inlineCode") and not text(node.get("value")))
                        or ("value" in node and not text(node["value"]))):
                    return False
            else:
                clusters += 1
                items = node.get("items")
                if (clusters > SUBSET["limits"]["clusters"] or not isinstance(items, list)
                        or not items or len(items) > SUBSET["limits"]["items"]):
                    return False
                if any(key in node and not text(node[key]) for key in ("prefix", "suffix")):
                    return False
                ids = set()
                for item in items:
                    if (not isinstance(item, dict) or not text(item.get("id"))
                            or not item["id"] or item["id"] in ids
                            or set(item) - {"id", "locator", "label", "suppressAuthor"}):
                        return False
                    ids.add(item["id"])
                    if item.get("suppressAuthor") is True:
                        suppressed.add(item["id"])
                    if "locator" in item and (not text(item["locator"]) or not matches(SUBSET["rangePattern"], item["locator"])):
                        return False
                    if "label" in item and item["label"] not in SUBSET["locatorLabels"]:
                        return False
                    if "suppressAuthor" in item and not isinstance(item["suppressAuthor"], bool):
                        return False
        return True

    for block in document["blocks"]:
        if (not isinstance(block, dict) or isinstance(block.get("schemaVersion"), bool)
                or block.get("schemaVersion") != 1 or block.get("type") not in SUBSET["blockTypes"]
                or not isinstance(block.get("data"), dict)):
            return "This citation document shape is outside the shared subset."
        data = block["data"]
        if block["type"] == "publisle:bibliography":
            if not isinstance(data.get("entries"), list):
                return "Bibliography entries must be an array."
            if len(entries) + len(data["entries"]) > SUBSET["limits"]["entries"]:
                return "Too many bibliography entries."
            for entry in data["entries"]:
                if (not isinstance(entry, dict) or set(entry) - set(SUBSET["entryFields"])
                        or not text(entry.get("id")) or not entry["id"]):
                    return "Unsupported bibliography entry."
                if any(key != "authors" and not text(value) for key, value in entry.items()):
                    return "Bibliography fields must be bounded plain text."
                if any(key != "id" and isinstance(value, str) and re.search(SUBSET["quotationPattern"], value)
                       for key, value in entry.items()):
                    return "CSL quotation processing is outside the shared subset."
                authors = entry.get("authors", [])
                if (not isinstance(authors, list) or len(authors) > SUBSET["limits"]["authors"]
                        or not all(text(author) and matches(SUBSET["namePattern"], author) for author in authors)):
                    return "Names require the shared Family or Family, Given representation."
                if "issued" in entry and not matches(SUBSET["yearPattern"], entry["issued"]):
                    return "Only four-digit Common Era years are supported."
                if "page" in entry and not matches(SUBSET["rangePattern"], entry["page"]):
                    return "Page ranges are outside the shared subset."
                if re.sub("^" + WHITESPACE + "+", "", entry.get("raw", "")).startswith("@"):
                    return "BibTeX acquisition is outside the portable citation role."
                if not entry.get("title") and not entry.get("raw"):
                    return "A title or literal reference is required."
                if style == "author-date" and not authors and not entry.get("issued"):
                    return "Author-date references need an author or year."
                entries.append(entry)
        elif not inline(data.get("content")):
            return "Inline citation content is outside the shared subset."
    if len(entries) > SUBSET["limits"]["entries"]:
        return "Too many bibliography entries."
    if style == "author-date":
        first = {}
        for entry in entries:
            first.setdefault(entry["id"], entry)
        if any(key in first and not first[key].get("issued") for key in suppressed):
            return "Author suppression requires a year in the shared subset."
    ambiguities = {}
    for entry in entries:
        authors = entry.get("authors", [])
        short = tuple(name.split(",")[0] for name in (authors[:1] if len(authors) >= 3 else authors))
        key = (short, len(authors) >= 3, entry.get("issued"))
        full = tuple(authors)
        if style == "author-date" and key in ambiguities and ambiguities[key] != full:
            return "Given-name and coauthor disambiguation is outside the shared subset."
        ambiguities[key] = full
    return None


def project_citations(document):
    """Project exactly the paragraph/heading/mark subset admitted above."""
    references, clusters, diagnostics = {}, [], []

    def inline(nodes):
        for node in nodes:
            if node["type"] == "citationReference":
                clusters.append(node)
            elif node["type"] in ("strong", "emphasis", "strikethrough"):
                inline(node["children"])

    for block in document["blocks"]:
        if block["type"] == "publisle:bibliography":
            for entry in block["data"]["entries"]:
                if entry["id"] in references:
                    if not any(item["code"] == "duplicate-bibliography-entry" for item in diagnostics):
                        diagnostics.append({"code": "duplicate-bibliography-entry", "message": "Duplicate reference uses the first entry."})
                else:
                    references[entry["id"]] = entry
        else:
            inline(block["data"]["content"])
    return references, clusters, diagnostics


def names(authors, locale, invert_first=False):
    rendered = []
    for index, author in enumerate(authors):
        family, separator, given = author.partition(", ")
        rendered.append(f"{family}, {given}" if separator and invert_first and index == 0
                        else f"{given} {family}" if separator else family)
    conjunction = "et" if locale == "fr-FR" else "and"
    if len(rendered) < 2:
        return "".join(rendered)
    return (", ".join(rendered[:-1]) + (", " if len(rendered) > 2 else " ")
            + conjunction + " " + rendered[-1])


def localized_range(value, locale):
    return value.replace("-", "‑" if locale == "fr-FR" else "–")


def sentences(parts):
    """Join populated CSL groups while suppressing adjacent punctuation."""
    value = ""
    for part in filter(None, parts):
        if value:
            value += " " if value.endswith((".", "?", "!", ";", ":")) else ". "
        value += part
    return value


def publication_details(entry, locale):
    volume, issue, page = (entry.get(field, "") for field in ("volume", "issue", "page"))
    if entry.get("type") in ("article-journal", "article-magazine", "article-newspaper"):
        number = volume + ("(" + issue + ")" if issue else "")
        location = ": ".join(filter(None, [number, localized_range(page, locale)]))
        container = ", ".join(filter(None, [entry.get("containerTitle", ""), location]))
    else:
        page_label = "pp." if locale != "fr-FR" and "-" in page else "p."
        container = ", ".join(filter(None, [entry.get("containerTitle", ""),
                              "vol. " + volume if volume else "",
                              "(" + issue + ")" if issue else "",
                              page_label + " " + localized_range(page, locale) if page else ""]))
    return sentences([container, entry.get("publisher", "")])


def numeric_marker(items, numbers, locale):
    items = sorted(items, key=lambda item: numbers[item["id"]])
    parts, index = [], 0
    while index < len(items):
        end = index + 1
        while (end < len(items) and not items[end - 1].get("locator") and not items[end].get("locator")
               and numbers[items[end]["id"]] == numbers[items[end - 1]["id"]] + 1):
            end += 1
        if end - index >= 3:
            parts.append(f'{numbers[items[index]["id"]]}–{numbers[items[end - 1]["id"]]}')
            index = end
            continue
        item = items[index]
        value = str(numbers[item["id"]])
        if item.get("locator"):
            plural = "-" in item["locator"]
            label = item.get("label", "page")
            if label == "p.":
                label = "page"
            terms = ({"page": "p.", "chapter": "chap.", "section": "sect."} if locale == "fr-FR"
                     else {"page": "pp." if plural else "p.", "chapter": "chaps." if plural else "chap.",
                           "section": "secs." if plural else "sec."})
            value += ", " + terms[label] + " " + localized_range(item["locator"], locale)
        parts.append(value)
        index += 1
    return "[" + ", ".join(parts) + "]"


def resolve_portable_citations(document, style="numeric", locale="en-US"):
    limit = portable_citation_limit(document, style, locale)
    result = {"classification": "rejected" if limit else "rendered", "capabilities": deepcopy(SUBSET["capabilities"]),
              "citations": [], "bibliography": [], "unresolved": [], "diagnostics": []}
    if limit:
        result["diagnostics"].append({"code": "unsupported-citation-feature", "message": limit})
        return result
    references, clusters, diagnostics = project_citations(document)
    for entry in references.values():
        if entry.get("raw") and not entry.get("title") and not entry.get("authors") and not entry.get("issued"):
            diagnostics.append({"code": "opaque-reference-literal", "message": "An unstructured reference is preserved literally."})
    cited, unresolved = {}, []
    for cluster in clusters:
        for item in cluster["items"]:
            key = item["id"]
            if key in references:
                cited.setdefault(key, len(cited) + 1)
            elif key not in unresolved:
                unresolved.append(key)
                diagnostics.append({"code": "unresolved-citation", "message": "Citation has no bibliography entry: " + key})
    ordered = list(cited)
    if style == "author-date":
        # Stable sort preserves first appearance for equal author/year keys,
        # matching the two keys in Publisle's built-in style (not title sort).
        ordered.sort(key=lambda key: (not references[key].get("authors"),
                                      tuple(name.lower() for name in references[key].get("authors", [])),
                                      not references[key].get("issued"), references[key].get("issued", "")))
    suffixes = {}
    groups = {}
    if style == "author-date":
        for key in ordered:
            entry = references[key]
            group = (tuple(entry.get("authors", [])), entry.get("issued", ""))
            groups.setdefault(group, []).append(key)
        for group in groups.values():
            if len(group) > 1 and references[group[0]].get("issued"):
                for index, key in enumerate(group):
                    # Same spreadsheet-style sequence used for suffixes beyond z.
                    suffix, number = "", index + 1
                    while number:
                        number, remainder = divmod(number - 1, 26)
                        suffix = chr(97 + remainder) + suffix
                    suffixes[key] = suffix
    for cluster in clusters:
        known = [item for item in cluster["items"] if item["id"] in references]
        missing = [item["id"] for item in cluster["items"] if item["id"] not in references]
        marker = ""
        if known and style == "numeric":
            marker = numeric_marker(known, cited, locale)
        elif known:
            parts = []
            for item in known:
                entry = references[item["id"]]
                authors = entry.get("authors", [])
                short = [name.split(",")[0] for name in authors]
                name = short[0] + " et al." if len(short) >= 3 else " & ".join(short)
                if item.get("suppressAuthor"):
                    name = ""
                year = entry.get("issued", "") + suffixes.get(item["id"], "")
                parts.append(", ".join(part for part in (name, year) if part) or "[CSL STYLE ERROR: reference with no printed form.]")
            marker = "(" + "; ".join(parts) + ")"
        if missing:
            marker += "[" + ", ".join(missing) + "]"
        result["citations"].append(normalize(cluster.get("prefix", "") + marker + cluster.get("suffix", "")))
    for index, key in enumerate(ordered):
        entry = references[key]
        author = names(entry.get("authors", []), locale, style == "author-date")
        year = entry.get("issued", "") + suffixes.get(key, "")
        opaque = (entry.get("raw") and not entry.get("title")
                  and not entry.get("authors") and not entry.get("issued"))
        title = entry["raw"] if opaque else entry.get("title", "")
        publication = publication_details(entry, locale)
        identifiers = sentences(["https://doi.org/" + entry["doi"] if entry.get("doi") else "",
                                 entry.get("url", "")])
        if style == "numeric":
            value = str(index + 1) + ". " + author + (", " + title if title else "")
            value = sentences([value, publication])
            if year:
                value += " (" + year + ")"
            value = sentences([value, identifiers])
        else:
            value = author + (" (" + year + ")" if year else "")
            value = sentences([value, title, publication, identifiers])
            if not value.endswith((".", "?", "!", ";", ":")):
                value += "."
        result["bibliography"].append({"id": key, "label": str(index + 1), "text": normalize(value)})
    result["unresolved"], result["diagnostics"] = unresolved, diagnostics
    result["classification"] = "fallback-with-diagnostic" if diagnostics else "rendered"
    return result


def main():
    import argparse
    from publisle import parse_json
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--style", default="numeric")
    parser.add_argument("--locale", default="en-US")
    parser.add_argument("--requests", action="store_true", help="Read a batch of document/style/locale requests")
    args = parser.parse_args()
    source = parse_json(args.source.read_bytes())
    result = ([resolve_portable_citations(item["document"], item.get("style", "numeric"), item.get("locale", "en-US"))
               for item in source] if args.requests else resolve_portable_citations(source, args.style, args.locale))
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
