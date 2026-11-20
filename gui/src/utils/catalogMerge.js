// Merge catalog pages by id: providers sometimes ignore the page parameter and
// answer with the same rows, which used to pile up as duplicate cards.
export const mergeUniqueResults = (existing = [], incoming = []) => {
  const seen = new Set();
  const merged = [];
  for (const item of [...existing, ...incoming]) {
    const key = item?.id;
    if (key == null) {
      merged.push(item);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
};
