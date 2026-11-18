import { test, expect } from "@playwright/test";
import { writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeEan13 } from "../fixtures/ean-symbol";

/**
 * Живой прогон сканера: Chrome кормится поддельной камерой, в которой крутится кадр с
 * настоящим штрихкодом. Проверяется вся цепочка — разрешение на камеру, кадры, разбор
 * (`src/lib/barcode/scan.ts`), контрольная цифра и ответ сервера по коду. Браузерного
 * `BarcodeDetector` в этой сборке Chrome для EAN нет, так что читает именно наш разбор.
 */

const CODE = "5449000000996";
const VIDEO = join(tmpdir(), "trientes-e2e-barcode.y4m");
const WIDTH = 640;
const HEIGHT = 480;
const FRAMES = 8;

/** Кадр с штрихкодом в формате Y4M — его Chrome умеет играть вместо камеры. */
function writeFakeCamera() {
  if (existsSync(VIDEO)) return;
  const bits = encodeEan13(CODE);
  const moduleWidth = 4;
  const x0 = Math.round((WIDTH - bits.length * moduleWidth) / 2);
  const y0 = Math.round(HEIGHT * 0.3);
  const y1 = Math.round(HEIGHT * 0.7);

  const y = Buffer.alloc(WIDTH * HEIGHT, 235);
  for (let row = y0; row < y1; row += 1) {
    for (let col = 0; col < WIDTH; col += 1) {
      const module = Math.floor((col - x0) / moduleWidth);
      if (module >= 0 && module < bits.length && bits[module] === "1") y[row * WIDTH + col] = 20;
    }
  }
  const chroma = Buffer.alloc((WIDTH / 2) * (HEIGHT / 2), 128);
  const header = Buffer.from(`YUV4MPEG2 W${WIDTH} H${HEIGHT} F25:1 Ip A1:1 C420mpeg2\n`);
  const frame = Buffer.concat([Buffer.from("FRAME\n"), y, chroma, chroma]);
  writeFileSync(VIDEO, Buffer.concat([header, ...Array.from({ length: FRAMES }, () => frame)]));
}

writeFakeCamera();

test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-video-capture=${VIDEO}`,
    ],
  },
  permissions: ["camera"],
});

test("the catalogue reads a barcode off the camera", async ({ page }) => {
  await page.goto("/en/products");
  const open = page.getByRole("button", { name: /scan/i });
  await expect(open).toBeVisible();
  await open.click();

  // Чем кончится — зависит от живой базы: есть паспорт с этим кодом, и браузер уедет в
  // него; нет — код будет назван словами. Доказательство в обоих случаях одно: код
  // прочитан камерой, проверен контрольной цифрой и спрошен у сервера.
  await expect
    .poll(
      async () => {
        if (page.url().includes("/product/")) return "passport";
        return (await page.getByText(CODE, { exact: false }).count()) > 0 ? "code" : "waiting";
      },
      { timeout: 25_000, intervals: [500] },
    )
    .not.toBe("waiting");
});
