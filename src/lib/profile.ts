export type ProfileInput = {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
};

export type ProfileValidated =
  | {
      ok: true;
      data: {
        firstName: string | null;
        lastName: string | null;
        phone: string | null;
        email: string | null;
      };
    }
  | { ok: false; reason: "first_name_too_long" | "last_name_too_long" | "phone_too_long" | "email_invalid" };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizePhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d+]/g, "");
  return cleaned.length > 0 ? cleaned : null;
}

function trimOrNull(s: string | undefined | null, max: number): string | null | { tooLong: true } {
  if (s == null) return null;
  const t = s.trim();
  if (t.length === 0) return null;
  if (t.length > max) return { tooLong: true };
  return t;
}

export function validateProfileInput(input: ProfileInput): ProfileValidated {
  const fn = trimOrNull(input.firstName, 80);
  if (fn && typeof fn === "object") return { ok: false, reason: "first_name_too_long" };
  const ln = trimOrNull(input.lastName, 80);
  if (ln && typeof ln === "object") return { ok: false, reason: "last_name_too_long" };
  const phRaw = trimOrNull(input.phone, 40);
  if (phRaw && typeof phRaw === "object") return { ok: false, reason: "phone_too_long" };
  const ph = normalizePhone(typeof phRaw === "string" ? phRaw : null);
  const emRaw = trimOrNull(input.email, 200);
  if (emRaw && typeof emRaw === "object") return { ok: false, reason: "email_invalid" };
  let em: string | null = null;
  if (typeof emRaw === "string") {
    const lower = emRaw.toLowerCase();
    if (!EMAIL_RE.test(lower)) return { ok: false, reason: "email_invalid" };
    em = lower;
  }
  return {
    ok: true,
    data: {
      firstName: typeof fn === "string" ? fn : null,
      lastName: typeof ln === "string" ? ln : null,
      phone: ph,
      email: em,
    },
  };
}
