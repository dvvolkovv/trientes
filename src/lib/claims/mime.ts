/**
 * Разбор письма: кодированные заголовки и текст тела (слайс CI).
 *
 * Своего разборщика MIME в проекте не было — писем мы до сих пор только
 * отправляли. Живая разведка 24 ноября показала, что без него в деле у
 * проверяющего оказался бы не текст письма, а границы частей, переносы со
 * знаком равенства и вторая, html-я копия того же текста; тема же выглядела бы
 * как `=?UTF-8?Q?…`.
 *
 * Берём ровно то, что нужно для чтения письма человеком: тему, имя отправителя
 * и текстовую часть. Вложения не разбираются и не сохраняются вовсе — файл от
 * неизвестного отправителя это отдельная дыра (правило AQ).
 */

/** Тело режем: в дело идёт текст письма, а не всё, что прислали. */
export const MAX_BODY_CHARS = 4_000;

/** Кодировки, которые встречаются в заголовках писем; прочие читаем как utf-8. */
function decodeBytes(bytes: Buffer, charset: string): string {
  const cs = charset.toLowerCase();
  if (cs === "utf-8" || cs === "utf8") return bytes.toString("utf8");
  if (cs === "iso-8859-1" || cs === "latin1" || cs === "windows-1252") {
    return bytes.toString("latin1");
  }
  try {
    return new TextDecoder(cs).decode(bytes);
  } catch {
    // Незнакомая кодировка — читаем как utf-8: негодные байты станут знаком
    // замены, но слово останется на месте. Отбросить его целиком было бы хуже.
    return bytes.toString("utf8");
  }
}

/** Снять `quoted-printable`: `=XX` и переносы строк со знаком равенства. */
export function decodeQuotedPrintable(text: string): Buffer {
  const joined = text.replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < joined.length; i += 1) {
    const ch = joined[i];
    if (ch === "=" && /^[0-9a-f]{2}$/i.test(joined.slice(i + 1, i + 3))) {
      out.push(parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
      continue;
    }
    for (const byte of Buffer.from(ch, "utf8")) out.push(byte);
  }
  return Buffer.from(out);
}

/**
 * Заголовок с кодированными словами (RFC 2047) → текст.
 * В Q-кодировке подчёркивание означает пробел — это её отличие от обычной
 * `quoted-printable`, и забыть о нём значит склеить слова темы.
 */
export function decodeHeaderWords(raw: string): string {
  const text = raw ?? "";
  if (!text.includes("=?")) return text.trim();
  let out = "";
  let rest = text;
  let previousWasWord = false;
  const word = /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/;
  for (let m = word.exec(rest); m !== null; m = word.exec(rest)) {
    const before = rest.slice(0, m.index);
    // Пробел между двумя кодированными словами по стандарту отбрасывается:
    // он там разделяет слова заголовка, а не текст.
    out += previousWasWord && before.trim() === "" ? "" : before;
    const [charset, encoding, payload] = [m[1], m[2].toLowerCase(), m[3]];
    const bytes =
      encoding === "b"
        ? Buffer.from(payload, "base64")
        : decodeQuotedPrintable(payload.replace(/_/g, " "));
    out += decodeBytes(bytes, charset);
    rest = rest.slice(m.index + m[0].length);
    previousWasWord = true;
  }
  return (out + rest).trim();
}

type Part = { headers: string; body: string };

function splitHeadersBody(raw: string): Part {
  const at = raw.search(/\r?\n\r?\n/);
  if (at === -1) return { headers: raw, body: "" };
  const gap = /^\r?\n\r?\n/.exec(raw.slice(at))?.[0].length ?? 2;
  return { headers: raw.slice(0, at), body: raw.slice(at + gap) };
}

function headerOf(headers: string, name: string): string | null {
  const unfolded = headers.replace(/\r?\n[ \t]+/g, " ");
  const re = new RegExp(`^${name}\\s*:(.*)$`, "im");
  const m = re.exec(unfolded);
  return m === null ? null : m[1].trim();
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

function decodeBody(part: Part): string {
  const encoding = (headerOf(part.headers, "content-transfer-encoding") ?? "").toLowerCase();
  const charset = /charset="?([^";\s]+)"?/i.exec(headerOf(part.headers, "content-type") ?? "")?.[1];
  if (encoding.startsWith("base64")) {
    return decodeBytes(Buffer.from(part.body.replace(/\s+/g, ""), "base64"), charset ?? "utf-8");
  }
  if (encoding.startsWith("quoted-printable")) {
    return decodeBytes(decodeQuotedPrintable(part.body), charset ?? "utf-8");
  }
  return part.body;
}

/** Текстовая часть письма: `text/plain` сильнее `text/html`. */
function findText(raw: string, depth = 0): { plain: string | null; html: string | null } {
  if (depth > 5) return { plain: null, html: null };
  const part = splitHeadersBody(raw);
  // Сам заголовок нужен в исходном виде: имя границы частей регистрозависимо
  // (`--_Part_1` и `--_part_1` — разные границы), а сравнивать тип удобнее в
  // нижнем. Один `toLowerCase()` на оба дела стоил живого теста.
  const contentTypeRaw = headerOf(part.headers, "content-type") ?? "text/plain";
  const contentType = contentTypeRaw.toLowerCase();
  const disposition = (headerOf(part.headers, "content-disposition") ?? "").toLowerCase();
  // Вложение текстом письма не является, даже когда оно текстовое.
  if (disposition.startsWith("attachment")) return { plain: null, html: null };

  if (contentType.startsWith("multipart/")) {
    const boundary = /boundary="?([^";\s]+)"?/i.exec(contentTypeRaw)?.[1];
    if (boundary === undefined) return { plain: null, html: null };
    // Группа должна быть незахватывающей: `split` с захватом вставляет её
    // значение (а при необязательной — `undefined`) между частями.
    const edge = boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const chunks = part.body.split(new RegExp(`\r?\n?--${edge}(?:--)?\r?\n?`));
    let plain: string | null = null;
    let html: string | null = null;
    for (const chunk of chunks) {
      if (chunk.trim() === "") continue;
      const inner = findText(chunk, depth + 1);
      plain ??= inner.plain;
      html ??= inner.html;
    }
    return { plain, html };
  }

  if (contentType.startsWith("text/html")) return { plain: null, html: decodeBody(part) };
  if (contentType.startsWith("text/") || contentType === "") {
    return { plain: decodeBody(part), html: null };
  }
  return { plain: null, html: null };
}

/**
 * Текст письма для дела: обрезанный, без разметки и без вложений.
 * `raw` — письмо целиком или его часть после заголовков конверта.
 */
export function extractText(raw: string): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const found = findText(raw);
  const source = found.plain ?? (found.html === null ? null : htmlToText(found.html));
  if (source === null) return null;
  const text = source
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text === "") return null;
  return text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}…` : text;
}
