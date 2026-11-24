import { describe, it, expect } from "vitest";
import { displayName, strongestMatch } from "@/lib/claims/inbound";
import { parseHeaders, header, messageIdOf, plainBody, mailboxConfig } from "@/lib/claims/mailbox";
import { welcomeEmail } from "@/lib/claims/letters";
import { inviteUrl, hashToken, inviteToken } from "@/lib/claims/invite";

/** Разбор письма и сборка приветственного письма — без базы и без сети. */

describe("parseHeaders", () => {
  const raw = [
    "Received: from mx.acala.network by mail.selyanska.eu",
    "Authentication-Results: mail.selyanska.eu;",
    "\tdkim=pass header.d=acala.network;",
    "\tspf=pass smtp.mailfrom=acala.network",
    'From: "Acala Ops" <ops@acala.network>',
    "Subject: This is our coin",
    "Message-ID: <abc-123@acala.network>",
  ].join("\r\n");

  it("склеивает продолжения строк", () => {
    const h = parseHeaders(raw);
    const auth = h.get("authentication-results") ?? [];
    expect(auth).toHaveLength(1);
    expect(auth[0]).toContain("dkim=pass header.d=acala.network");
    expect(auth[0]).toContain("spf=pass");
  });

  it("читает имена без учёта регистра", () => {
    expect(header(parseHeaders(raw), "SUBJECT")).toBe("This is our coin");
  });

  it("достаёт Message-ID без угловых скобок", () => {
    expect(messageIdOf(parseHeaders(raw))).toBe("abc-123@acala.network");
  });

  it("письмо без Message-ID опознать нечем", () => {
    expect(messageIdOf(parseHeaders("From: a@b.com"))).toBeNull();
  });

  it("останавливается на пустой строке: тело заголовками не является", () => {
    const h = parseHeaders("From: a@b.com\r\n\r\nSubject: not-a-header");
    expect(header(h, "subject")).toBeNull();
  });
});

describe("plainBody", () => {
  it("читает письмо целиком: тип и кодировка объявлены в его заголовках", () => {
    expect(plainBody("Content-Type: text/html\r\n\r\n<p>Hello</p>")).toBe("Hello");
    expect(plainBody(`Content-Type: text/plain\r\n\r\n${"x".repeat(5_000)}`)?.length).toBe(4_001);
  });

  it("пустое тело — это null, а не пустая строка", () => {
    expect(plainBody("   \n  ")).toBeNull();
    expect(plainBody(null)).toBeNull();
  });
});

describe("mailboxConfig", () => {
  it("без ключей ящика двери нет вовсе", () => {
    expect(mailboxConfig({} as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(mailboxConfig({ CLAIM_IMAP_HOST: "h", CLAIM_IMAP_USER: "u" } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });

  it("публичный адрес по умолчанию — имя входа", () => {
    const cfg = mailboxConfig({
      CLAIM_IMAP_HOST: "mail.selyanska.eu",
      CLAIM_IMAP_USER: "Listing@Trientes.org",
      CLAIM_IMAP_PASS: "x",
      SMTP_HOST: "mail.selyanska.eu",
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg?.address).toBe("listing@trientes.org");
    expect(cfg?.port).toBe(993);
    expect(cfg?.authServer).toBe("mail.selyanska.eu");
  });

  it("негодный порт не ломает настройку", () => {
    const cfg = mailboxConfig({
      CLAIM_IMAP_HOST: "h",
      CLAIM_IMAP_USER: "u",
      CLAIM_IMAP_PASS: "p",
      CLAIM_IMAP_PORT: "нет",
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg?.port).toBe(993);
  });
});

describe("displayName", () => {
  it("берёт имя из формы с кавычками", () => {
    expect(displayName('"Acala Ops" <ops@acala.network>')).toBe("Acala Ops");
  });

  it("голый адрес имени не несёт", () => {
    expect(displayName("ops@acala.network")).toBeNull();
  });
});

describe("strongestMatch", () => {
  const t = (match: "EXACT" | "PARENT" | "SUBDOMAIN") => ({
    subjectKind: "COIN_CARD" as const,
    subjectId: "x",
    subjectName: "X",
    subjectDomain: "x.io",
    match,
    owned: false,
  });

  it("равенство сильнее родителя, родитель сильнее поддомена", () => {
    expect(strongestMatch([t("SUBDOMAIN"), t("EXACT")])).toBe("EXACT");
    expect(strongestMatch([t("SUBDOMAIN"), t("PARENT")])).toBe("PARENT");
    expect(strongestMatch([t("SUBDOMAIN")])).toBe("SUBDOMAIN");
  });
});

describe("welcomeEmail", () => {
  const letter = welcomeEmail({
    domain: "acala.network",
    links: [{ name: "Acala (ACA)", url: "https://trientes.org/en/project-invite/tok" }],
    forProjectsUrl: "https://trientes.org/en/for-projects",
  });

  it("называет домен, по которому мы признали письмо своим", () => {
    expect(letter.text).toContain("acala.network");
    expect(letter.subject).toContain("acala.network");
  });

  it("несёт ссылку приглашения и говорит, что она одноразовая", () => {
    expect(letter.text).toContain("https://trientes.org/en/project-invite/tok");
    expect(letter.text).toMatch(/works once/i);
  });

  it("приглашает прислать своё API — просьба владельца", () => {
    expect(letter.text).toMatch(/API/);
  });

  it("ведёт на страницу для проектов", () => {
    expect(letter.text).toContain("/en/for-projects");
  });
});

describe("invite token", () => {
  it("ссылка строится от адреса сайта и локали", () => {
    expect(inviteUrl("https://trientes.org/", "tok", "ru")).toBe(
      "https://trientes.org/ru/project-invite/tok",
    );
  });

  it("в базе лежит отпечаток, а не сама ссылка", () => {
    const token = inviteToken();
    const hash = hashToken(token);
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(token);
    expect(hashToken(token)).toBe(hash);
  });
});
