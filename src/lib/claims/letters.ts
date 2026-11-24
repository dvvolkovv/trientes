/**
 * Письма проекту (слайс CI). Чистые функции: текст письма — то, что стоит
 * читать тестом, а не вызывать через сеть.
 *
 * По-английски: получатель не наш пользователь, и языка его мы не знаем
 * (прецедент — служебные уведомления сотрудникам). Письма заявителю на языке
 * его кабинета бывают там, где кабинет есть; здесь его нет по построению.
 */

export type InviteLink = { name: string; url: string };

/** Приветственное письмо: та самая «поздравительная открытка» с правами внутри. */
export function welcomeEmail(input: {
  domain: string;
  links: InviteLink[];
  forProjectsUrl: string;
}): { subject: string; text: string } {
  const site = input.forProjectsUrl.replace(/\/[a-zA-Z-]+\/for-projects\/?$/, "");
  const lines = [
    `Welcome to Trientes — the crypto aggregator at ${site}.`,
    "",
    `We confirmed that your message came from ${input.domain}, so we are glad to hand the page over to your team.`,
    "",
    input.links.length === 1 ? "Your page:" : "Your pages:",
    ...input.links.map((l) => `  ${l.name}: ${l.url}`),
    "",
    "Each link works once and expires in 14 days. Follow it and sign in (or create an account) — the page becomes yours to edit.",
    "",
    "What we already read ourselves, with no input from you: prices and trading pairs from exchange tickers, and on-chain facts straight from your nodes — issuance, block time, finality, transfer fee.",
    `What you can add: description, logo, links, tokenomics, team, payment and legal details — see ${input.forProjectsUrl}.`,
    "",
    "If you publish the data you send to other aggregators over an API or a JSON feed, reply with the address: our engineers will connect it, so your page stays current without anyone typing it in.",
    "",
    "— Trientes",
  ];
  return { subject: `Welcome to Trientes — ${input.domain}`, text: lines.join("\n") };
}

/** Отказ: причина словами и приглашение написать снова. */
export function rejectionEmail(input: {
  domain: string;
  reason: string;
}): { subject: string; text: string } {
  return {
    subject: `Trientes — ${input.domain}`,
    text: [
      `We could not hand over the ${input.domain} pages on Trientes.`,
      "",
      input.reason,
      "",
      "You are welcome to write to us again with whatever is missing.",
      "",
      "— Trientes",
    ].join("\n"),
  };
}
