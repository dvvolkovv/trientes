/**
 * Доказательство домена во входящем письме (слайс CI).
 *
 * Поле `From` — текст, который пишет отправитель: подделать его стоит ноль, и
 * «домен совпал» по `From` было бы проверкой только на вид. Доказывает одно —
 * подпись домена, проверенная НАШИМ почтовым сервером при приёме: он ставит
 * `Authentication-Results`, и `header.d=` подписи подделать, не владея
 * приватным ключом домена, нельзя.
 *
 * Отсюда три правила разбора, и каждое из них — защита, а не придирка:
 *   1. читаем только заголовок, чей `authserv-id` равен нашему серверу —
 *      остальные такие заголовки пишут чужие релеи, и отправитель вправе
 *      вписать свой;
 *   2. берём верхний наш заголовок — при приёме он добавляется сверху, нижние
 *      могли прийти из письма;
 *   3. `pass` и только `pass`; `none`, `fail`, `temperror` доказательством не
 *      являются.
 */

/** Чем доказан домен: подписью самого домена или согласованием DMARC+SPF. */
export type ProofKind = "DKIM" | "DMARC_SPF";

export type ProvedDomain = {
  domain: string;
  proof: ProofKind;
};

/** Домен, на который может прийти почта: метки и хотя бы одна точка. */
const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Домен → нижний регистр, без `www.`, без точки на конце; null — не домен. */
function normalizeDomain(raw: string): string | null {
  const bare = raw
    .trim()
    .replace(/^["'<]+|["'>]+$/g, "")
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
  if (!DOMAIN.test(bare)) return null;
  // Домен верхнего уровня без точки (`localhost`) и однобуквенные выдумки
  // доказательством быть не могут.
  if (!/\.[a-z]{2,}$/.test(bare)) return null;
  return bare;
}

/** Адрес из заголовка `From`: форма с именем или голая. */
export function fromAddress(header: string): string | null {
  const text = (header ?? "").trim();
  if (text === "") return null;
  const angled = /<([^<>]+)>\s*$/.exec(text);
  const candidate = (angled ? angled[1] : text).trim().toLowerCase();
  const at = candidate.lastIndexOf("@");
  if (at <= 0 || at === candidate.length - 1) return null;
  const local = candidate.slice(0, at);
  const domain = normalizeDomain(candidate.slice(at + 1));
  if (domain === null) return null;
  if (!/^[^\s@,;"]+$/.test(local)) return null;
  return `${local}@${domain}`;
}

/** Домен адреса `From` — нормализованный, как и всё остальное. */
export function fromDomain(header: string): string | null {
  const address = fromAddress(header);
  return address === null ? null : address.slice(address.lastIndexOf("@") + 1);
}

/**
 * Значение заголовка без его имени: в письме строка приходит целиком
 * (`Authentication-Results: …`), и отрезать имя должен разбор, а не вызывающий
 * — иначе один забытый срез делает проверку бессильной.
 */
function headerValue(line: string): string {
  return (line ?? "").replace(/^\s*authentication-results\s*:/i, "").trim();
}

/** Имя сервера из начала заголовка: `<authserv-id>; …`. */
function authServId(line: string): string | null {
  const head = headerValue(line).split(";", 1)[0] ?? "";
  const id = head.trim().toLowerCase().replace(/\.$/, "");
  return id === "" ? null : id;
}

/**
 * Доказанные домены письма.
 *
 * `headers` — значения всех заголовков `Authentication-Results` в том порядке,
 * в каком они стоят в письме (сверху вниз); `ourServer` — имя нашего сервера
 * (`SMTP_HOST`); `from` — значение заголовка `From`.
 */
export function provedDomains(
  headers: readonly string[],
  ourServer: string,
  from: string,
): ProvedDomain[] {
  const ours = (ourServer ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (ours === "") return [];
  const line = headers.find((h) => authServId(h) === ours);
  if (line === undefined) return [];
  const mine = headerValue(line);

  const out: ProvedDomain[] = [];
  const seen = new Set<string>();
  const add = (domain: string, proof: ProofKind) => {
    if (seen.has(domain)) return;
    seen.add(domain);
    out.push({ domain, proof });
  };

  // Подписи домена: `dkim=pass header.d=<домен>`. Их может быть несколько —
  // домен проекта и домен рассыльщика; доказан каждый, а какой из них подходит
  // объекту, решает сравнение с его сайтом.
  const dkim = /\bdkim\s*=\s*([a-z]+)((?:[^;]|$)*)/g;
  for (let m = dkim.exec(mine); m !== null; m = dkim.exec(mine)) {
    if (m[1].toLowerCase() !== "pass") continue;
    const d = /\bheader\.d\s*=\s*([^\s;()]+)/i.exec(m[2] ?? "");
    if (d === null) continue;
    const domain = normalizeDomain(d[1]);
    if (domain !== null) add(domain, "DKIM");
  }

  // Согласование DMARC: оно доказывает домен `From`, но только вместе с
  // `spf=pass` — DMARC проходит и через подпись чужого домена, и тогда доказан
  // этот чужой домен, а не тот, что написан в `From`.
  const dmarcPass = /\bdmarc\s*=\s*pass\b/i.test(mine);
  const spfPass = /\bspf\s*=\s*pass\b/i.test(mine);
  if (dmarcPass && spfPass) {
    const domain = fromDomain(from);
    if (domain !== null) add(domain, "DMARC_SPF");
  }

  return out;
}
