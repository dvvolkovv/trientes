// Outbound email through the shared Mailcow server (mail.selyanska.eu) over SMTP
// submission. Best-effort like every other channel: callers get { ok, reason },
// never an exception, and nothing is sent until SMTP_USER/SMTP_PASS are set.
import nodemailer, { type Transporter } from "nodemailer";

let transporter: Transporter | null = null;
let warned = false;

function getTransporter(): Transporter | null {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    if (!warned) {
      console.warn("[email] SMTP credentials missing — email sending disabled");
      warned = true;
    }
    return null;
  }
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT ?? 587);
    // 465 is implicit TLS; on 587 refuse to authenticate unless STARTTLS succeeds.
    const secure = port === 465;
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? "mail.selyanska.eu",
      port,
      secure,
      requireTLS: !secure,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
      auth: { user, pass },
    });
  }
  return transporter;
}

// Recipients and subjects can carry user data; a bare CR/LF would let it add headers.
function hasHeaderInjection(value: string): boolean {
  return /[\r\n\0]/.test(value);
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]!);
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const from = process.env.SMTP_FROM_EMAIL ?? process.env.SMTP_USER ?? "";
  if ([input.to, input.subject, from].some(hasHeaderInjection)) {
    return { ok: false, reason: "invalid_email_header" };
  }
  const smtp = getTransporter();
  if (!smtp) return { ok: false, reason: "email_not_configured" };
  try {
    const info = await smtp.sendMail({
      from: { name: "Trientes", address: from },
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html ?? escapeHtml(input.text).replace(/\n/g, "<br/>"),
    });
    if (!Array.isArray(info.accepted) || info.accepted.length === 0) {
      return { ok: false, reason: "smtp_recipient_rejected" };
    }
    return { ok: true };
  } catch (err) {
    // The error message can echo the SMTP dialogue; log only its codes.
    const { code, responseCode } = (err ?? {}) as { code?: unknown; responseCode?: unknown };
    console.error("[email] SMTP send failed", { code, responseCode });
    return { ok: false, reason: "smtp_send_failed" };
  }
}
