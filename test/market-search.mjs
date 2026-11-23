// Replays the market's own search normalization against a candidate description,
// so the entry is checked with the matcher that will actually run in the store
// rather than by eye. Logic copied from dshmarket/client/client.js:
//   searchText(): NFKC, lowercase, insert a space at every Han<->Latin/digit
//   boundary, collapse everything that is not a letter or digit to a space.
//   A query matches a field when EVERY token is a substring of that field.
const searchScriptBoundary =
  /(?:\p{Script=Han}(?=[\p{Script=Latin}\p{N}])|[\p{Script=Latin}\p{N}](?=\p{Script=Han}))/gu

const searchText = (value) =>
  String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(searchScriptBoundary, '$& ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')

export function fieldMatches(field, query) {
  const text = searchText(field)
  const q = searchText(query)
  if (!text || !q) return false
  return q.split(' ').filter(Boolean).every((t) => text.includes(t))
}

// Whole-entry match: name, owner, description (both locales) and the category
// id plus its localized label. That is exactly the set pluginRelevance() ranks.
export function entryMatches(entry, query, categoryLabel) {
  const fields = [
    entry.name,
    entry.url.split('/')[3],
    entry.description.en,
    entry.description.zh,
    entry.category,
    categoryLabel,
  ]
  return fields.some((f) => fieldMatches(f, query))
}
