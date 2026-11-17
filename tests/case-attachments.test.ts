import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_PER_MESSAGE,
  attachmentUrl,
  extForMime,
  isSafeAttachmentName,
  parseAttachments,
} from "@/lib/cases/attachments";

describe("extForMime", () => {
  it("пропускает документы и картинки", () => {
    expect(extForMime("application/pdf")).toBe("pdf");
    expect(extForMime("image/jpeg")).toBe("jpg");
    expect(extForMime("image/png")).toBe("png");
    expect(extForMime("image/webp")).toBe("webp");
  });

  it("всё прочее отвергает", () => {
    expect(extForMime("image/svg+xml")).toBeNull();
    expect(extForMime("text/html")).toBeNull();
    expect(extForMime("")).toBeNull();
  });
});

describe("isSafeAttachmentName", () => {
  it("принимает только наше собственное имя", () => {
    expect(isSafeAttachmentName("0123456789abcdef01234567.pdf")).toBe(true);
  });

  it("не пускает выход из каталога и чужие расширения", () => {
    expect(isSafeAttachmentName("../../etc/passwd")).toBe(false);
    expect(isSafeAttachmentName("0123456789abcdef01234567.sh")).toBe(false);
    expect(isSafeAttachmentName("0123456789abcdef01234567.pdf/../x.pdf")).toBe(false);
    expect(isSafeAttachmentName("ZZZ456789abcdef01234567.pdf")).toBe(false);
    expect(isSafeAttachmentName("")).toBe(false);
  });
});

describe("parseAttachments", () => {
  it("читает нашу запись", () => {
    const list = parseAttachments([
      { name: "0123456789abcdef01234567.pdf", filename: "устав.pdf", size: 12, mime: "application/pdf" },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0]!.filename).toBe("устав.pdf");
  });

  it("мусор роняет не страницу, а только запись", () => {
    expect(parseAttachments(null)).toEqual([]);
    expect(parseAttachments("строка")).toEqual([]);
    expect(parseAttachments([{ name: "../x.pdf", filename: "a", size: 1, mime: "application/pdf" }])).toEqual([]);
    expect(parseAttachments([{ nope: true }])).toEqual([]);
  });

  it("имя файла от заявителя не кусается", () => {
    const list = parseAttachments([
      { name: "0123456789abcdef01234567.png", filename: "<img src=x onerror=1>.png", size: 1, mime: "image/png" },
    ]);
    expect(list[0]!.filename).toBe("img src=x onerror=1.png");
  });

  it("больше пяти вложений в сообщении не бывает", () => {
    const one = { name: "0123456789abcdef01234567.png", filename: "a.png", size: 1, mime: "image/png" };
    expect(parseAttachments(Array.from({ length: 9 }, () => one))).toHaveLength(ATTACHMENT_MAX_PER_MESSAGE);
  });
});

describe("attachmentUrl", () => {
  it("ведёт на маршрут с проверкой прав, а не в публичный корень", () => {
    expect(attachmentUrl("case1", "0123456789abcdef01234567.pdf")).toBe(
      "/api/case-attachment/case1/0123456789abcdef01234567.pdf",
    );
  });
});

describe("ATTACHMENT_MAX_BYTES", () => {
  it("восемь мегабайт, как у KYB", () => {
    expect(ATTACHMENT_MAX_BYTES).toBe(8 * 1024 * 1024);
  });
});
