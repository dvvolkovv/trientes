import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "test-smtp-secret-value";

const smtp = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: smtp.createTransport },
}));

// email.ts caches the transporter and the "not configured" warning per module
// instance, so every test gets a fresh copy.
async function loadEmail() {
  vi.resetModules();
  return import("@/lib/email");
}

describe("sendEmail (Mailcow SMTP)", () => {
  beforeEach(() => {
    smtp.createTransport.mockReset().mockReturnValue({ sendMail: smtp.sendMail });
    smtp.sendMail.mockReset().mockResolvedValue({ accepted: ["listing@trientes.org"], rejected: [] });
    vi.stubEnv("SMTP_HOST", "mail.selyanska.eu");
    vi.stubEnv("SMTP_PORT", "587");
    vi.stubEnv("SMTP_USER", "noreply@trientes.org");
    vi.stubEnv("SMTP_PASS", SECRET);
    vi.stubEnv("SMTP_FROM_EMAIL", "noreply@trientes.org");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("submits over STARTTLS on 587 with bounded timeouts", async () => {
    const { sendEmail } = await loadEmail();

    await expect(
      sendEmail({ to: "listing@trientes.org", subject: "Hello", text: "Body" }),
    ).resolves.toEqual({ ok: true });

    expect(smtp.createTransport).toHaveBeenCalledWith({
      host: "mail.selyanska.eu",
      port: 587,
      secure: false,
      requireTLS: true,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
      auth: { user: "noreply@trientes.org", pass: SECRET },
    });
    expect(smtp.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: { name: "Trientes", address: "noreply@trientes.org" },
        to: "listing@trientes.org",
        subject: "Hello",
        text: "Body",
      }),
    );
  });

  it("uses implicit TLS on 465 and reuses one transporter", async () => {
    vi.stubEnv("SMTP_PORT", "465");
    const { sendEmail } = await loadEmail();

    await sendEmail({ to: "a@example.com", subject: "One", text: "1" });
    await sendEmail({ to: "b@example.com", subject: "Two", text: "2" });

    expect(smtp.createTransport).toHaveBeenCalledTimes(1);
    expect(smtp.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 465, secure: true, requireTLS: false }),
    );
    expect(smtp.sendMail).toHaveBeenCalledTimes(2);
  });

  it("escapes the plain-text body when deriving the HTML part", async () => {
    const { sendEmail } = await loadEmail();

    await sendEmail({ to: "listing@trientes.org", subject: "Coin", text: "<b>Coin</b>\nA & B \"q\" 'q'" });

    expect(smtp.sendMail.mock.calls[0]![0].html).toBe(
      "&lt;b&gt;Coin&lt;/b&gt;<br/>A &amp; B &quot;q&quot; &#39;q&#39;",
    );
  });

  it("reports email_not_configured without credentials and warns once", async () => {
    vi.stubEnv("SMTP_PASS", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sendEmail } = await loadEmail();

    await expect(sendEmail({ to: "a@example.com", subject: "s", text: "t" })).resolves.toEqual({
      ok: false,
      reason: "email_not_configured",
    });
    await sendEmail({ to: "a@example.com", subject: "s", text: "t" });

    expect(smtp.createTransport).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["to", { to: "a@example.com\r\nBcc: victim@example.com", subject: "s" }],
    ["subject", { to: "a@example.com", subject: "s\nBcc: victim@example.com" }],
  ])("rejects header injection in %s", async (_field, header) => {
    const { sendEmail } = await loadEmail();

    await expect(sendEmail({ ...header, text: "t" })).resolves.toEqual({
      ok: false,
      reason: "invalid_email_header",
    });
    expect(smtp.sendMail).not.toHaveBeenCalled();
  });

  it("rejects header injection in the configured from address", async () => {
    vi.stubEnv("SMTP_FROM_EMAIL", "noreply@trientes.org\r\nBcc: victim@example.com");
    const { sendEmail } = await loadEmail();

    await expect(sendEmail({ to: "a@example.com", subject: "s", text: "t" })).resolves.toEqual({
      ok: false,
      reason: "invalid_email_header",
    });
    expect(smtp.sendMail).not.toHaveBeenCalled();
  });

  it("maps transport errors to smtp_send_failed without logging the secret", async () => {
    const err = Object.assign(new Error(`535 auth failed for noreply@trientes.org:${SECRET}`), {
      code: "EAUTH",
      responseCode: 535,
    });
    smtp.sendMail.mockRejectedValueOnce(err);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { sendEmail } = await loadEmail();

    const result = await sendEmail({ to: "a@example.com", subject: "s", text: "t" });

    expect(result).toEqual({ ok: false, reason: "smtp_send_failed" });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(error).toHaveBeenCalledWith("[email] SMTP send failed", { code: "EAUTH", responseCode: 535 });
    expect(JSON.stringify(error.mock.calls)).not.toContain(SECRET);
  });

  it("treats an empty accepted list as smtp_recipient_rejected", async () => {
    smtp.sendMail.mockResolvedValueOnce({ accepted: [], rejected: ["a@example.com"] });
    const { sendEmail } = await loadEmail();

    await expect(sendEmail({ to: "a@example.com", subject: "s", text: "t" })).resolves.toEqual({
      ok: false,
      reason: "smtp_recipient_rejected",
    });
  });
});
