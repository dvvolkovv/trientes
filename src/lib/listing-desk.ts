// Heads-up mail to the listing desk mailbox (listing@trientes.org unless
// LISTING_REQUESTS_TO says otherwise). Submissions are already stored and
// moderated in /admin, so callers only log a failure — this never throws.
import { sendEmail } from "@/lib/email";

export function listingDeskAdminUrl(section: string): string {
  const origin = (process.env.PUBLIC_ORIGIN ?? "https://trientes.org").replace(/\/+$/, "");
  return `${origin}/en/admin/${section}`;
}

export async function mailListingDesk(
  subject: string,
  text: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const r = await sendEmail({
      to: process.env.LISTING_REQUESTS_TO ?? "listing@trientes.org",
      subject,
      text,
    });
    return r.ok ? { ok: true } : { ok: false, reason: r.reason ?? "unknown" };
  } catch {
    return { ok: false, reason: "email_helper_exception" };
  }
}
