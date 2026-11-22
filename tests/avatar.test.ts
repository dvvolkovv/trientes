import { describe, expect, it } from "vitest";
import { avatarExtension, avatarFilePath, avatarUrl } from "@/lib/avatar";

const head = (...bytes: number[]) => new Uint8Array(bytes);
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

describe("avatarExtension", () => {
  it("узнаёт png, jpeg и webp по первым байтам", () => {
    expect(avatarExtension(head(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0))).toBe("png");
    expect(avatarExtension(head(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe("jpg");
    expect(avatarExtension(head(...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WEBP")))).toBe("webp");
  });

  // Заявленный тип тут ни при чём: файл потом отдаёт nginx по расширению,
  // которое придумали мы, а svg с нашего домена — это хранимый XSS.
  it("не узнаёт svg и мусор", () => {
    expect(avatarExtension(head(...ascii("<svg xmlns")))).toBe(null);
    expect(avatarExtension(head(0, 0, 0, 0))).toBe(null);
    expect(avatarExtension(head())).toBe(null);
  });

  it("RIFF без WEBP картинкой не считается", () => {
    expect(avatarExtension(head(...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WAVE")))).toBe(null);
  });
});

describe("avatarFilePath", () => {
  const user = "ckuser";
  const name = "0123456789abcdef01234567.png";

  it("наш файл этого человека", () => {
    expect(avatarFilePath(avatarUrl(user, name), user)).toContain(`${user}/${name}`);
  });

  it("чужой снимок (Google) стирать нечего", () => {
    expect(avatarFilePath("https://lh3.googleusercontent.com/a/abc", user)).toBe(null);
  });

  it("каталог другого человека не наш", () => {
    expect(avatarFilePath(avatarUrl("someone", name), user)).toBe(null);
  });

  it("выход из каталога именем файла не проходит", () => {
    expect(avatarFilePath(`/uploads/avatars/${user}/../../../etc/passwd`, user)).toBe(null);
    expect(avatarFilePath(`/uploads/avatars/${user}/shell.php`, user)).toBe(null);
  });
});
