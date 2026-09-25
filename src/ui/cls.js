/** A class attribute from names, skipping the falsy ones. */
export function cls(...names) {
  return names.filter(Boolean).join(" ");
}
