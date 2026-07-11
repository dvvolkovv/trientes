import { Resend } from "resend";

let client: Resend | null = null;
let warned = false;

function getClient(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (!warned) {
      console.warn("[email] RESEND_API_KEY missing — email sending disabled");
      warned = true;
    }
    return null;
  }
  if (!client) client = new Resend(key);
  return client;
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const c = getClient();
  if (!c) return { ok: false, reason: "email_not_configured" };
  const from = process.env.RESEND_FROM_EMAIL ?? "notifications@trientes.org";
  try {
    await c.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html ?? input.text.replace(/\n/g, "<br/>"),
    });
    return { ok: true };
  } catch (err) {
    console.error("[email] send failed:", err);
    return { ok: false, reason: String(err) };
  }
}
