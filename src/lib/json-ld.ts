// JSON.stringify leaves these characters as they are. Inside an inline
// <script type="application/ld+json"> a `<` can close the element
// (`</script>`) or open a comment (`<!--`) in the server-rendered HTML; U+2028
// and U+2029 end a line in pre-ES2019 JavaScript. Each replacement is a JSON
// string escape, so JSON.parse returns the same value.
const UNSAFE_CHARACTERS = /[<>&\u2028\u2029]/g;
const ESCAPES: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

/**
 * Serializes structured data for an inline JSON-LD script element. Its values
 * (company, fintech and coin names, descriptions, logo URLs) are written by
 * third parties, so raw JSON.stringify output there is stored XSS.
 */
export function serializeJsonLd(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) {
    throw new TypeError("JSON-LD value has no JSON representation");
  }
  return json.replace(UNSAFE_CHARACTERS, (character) => ESCAPES[character]);
}
