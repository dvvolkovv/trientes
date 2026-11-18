"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { scanFrame } from "@/lib/barcode/scan";
import { parseGtin } from "@/lib/products/gtin";

/**
 * Сканер штрихкода камерой телефона.
 *
 * Два читателя, и порядок между ними не случаен: сперва браузерный `BarcodeDetector`
 * (он есть у Chrome на Android и разбирает код под наклоном лучше нашего), а где его нет
 * — а это весь Safari, то есть все iPhone, — работает наш разбор кадра
 * (`src/lib/barcode/scan.ts`). Чего нельзя: верить любому из них на слово — код
 * проверяется контрольной цифрой (`parseGtin`) и должен прочитаться **дважды**, иначе
 * одна осечка завела бы паспорт чужого товара.
 *
 * Камеры нет вовсе — кнопки нет вовсе: обещать «нажми и сними» там, где снять нечем,
 * хуже, чем не обещать. Набор цифр руками остаётся всегда — сканер это помощь, а не
 * единственная дверь.
 */

const SCAN_INTERVAL_MS = 120;
/** Одного чтения мало: контрольная цифра не ловит осечку, сложившуюся в годный код. */
const CONFIRMATIONS = 2;
const MAX_SCAN_WIDTH = 640;

type NativeDetector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type DetectorCtor = {
  new (options: { formats: string[] }): NativeDetector;
  getSupportedFormats?: () => Promise<string[]>;
};

const WANTED_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];

async function makeNativeDetector(): Promise<NativeDetector | null> {
  const ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (!ctor) return null;
  try {
    const supported = (await ctor.getSupportedFormats?.()) ?? WANTED_FORMATS;
    const formats = WANTED_FORMATS.filter((f) => supported.includes(f));
    if (formats.length === 0) return null;
    return new ctor({ formats });
  } catch {
    return null;
  }
}

function cameraError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "camera_denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "camera_missing";
  return "failed";
}

export function BarcodeScanButton({ onCode, className }: { onCode: (code: string) => void; className?: string }) {
  const t = useTranslations("scanner");
  const [supported, setSupported] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Проверка в эффекте, а не при отрисовке: на сервере `navigator` нет, и разметка
    // сервера и клиента должна совпасть.
    setSupported(typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia));
  }, []);

  if (!supported) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className ?? "h-12 px-4 rounded-md border border-hairline text-sm whitespace-nowrap flex items-center gap-2 hover:border-accent"}
      >
        <span aria-hidden>📷</span>
        {t("open")}
      </button>
      {open ? (
        <ScannerOverlay
          onClose={() => setOpen(false)}
          onCode={(code) => {
            setOpen(false);
            onCode(code);
          }}
        />
      ) : null}
    </>
  );
}

function ScannerOverlay({ onClose, onCode }: { onClose: () => void; onCode: (code: string) => void }) {
  const t = useTranslations("scanner");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  // Обработчик держим ссылкой: приди он в зависимости эффекта — камера перезапускалась
  // бы на каждую отрисовку родителя, то есть мигала бы в руках.
  const report = useRef(onCode);
  report.current = onCode;

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let busy = false;
    let detector: NativeDetector | null = null;
    const seen = new Map<string, number>();
    const canvas = document.createElement("canvas");

    const release = () => {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
      stream?.getTracks().forEach((track) => track.stop());
      const video = videoRef.current;
      if (video) video.srcObject = null;
    };

    const tick = async () => {
      if (busy || stopped) return;
      busy = true;
      try {
        const video = videoRef.current;
        if (!video || video.readyState < 2 || !video.videoWidth) return;

        const scale = Math.min(1, MAX_SCAN_WIDTH / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        let code: string | null = null;
        if (detector) {
          try {
            for (const found of await detector.detect(canvas)) {
              const gtin = parseGtin(found.rawValue);
              if (gtin) {
                code = gtin;
                break;
              }
            }
          } catch {
            // Браузерный читатель сорвался — дальше читаем своим, а не бросаем кадры.
            detector = null;
          }
        }
        if (!code) {
          code = scanFrame(ctx.getImageData(0, 0, canvas.width, canvas.height));
        }
        if (!code || stopped) return;

        const times = (seen.get(code) ?? 0) + 1;
        seen.set(code, times);
        if (times < CONFIRMATIONS) return;

        release();
        report.current(code);
      } finally {
        busy = false;
      }
    };

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // Задняя камера — та, которой наводят на упаковку; «ideal», а не «exact»:
          // на ноутбуке задней камеры нет, и жёсткое требование закрыло бы сканер совсем.
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch (e) {
        if (!stopped) setError(cameraError(e));
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // iOS иногда отказывает в автозапуске — кадры всё равно идут, читаем дальше.
      }
      detector = await makeNativeDetector();
      if (stopped) return;
      setLive(true);
      timer = setInterval(() => void tick(), SCAN_INTERVAL_MS);
    };

    void start();
    return release;
  }, []);

  return (
    <div className="fixed inset-0 z-[80] bg-black flex flex-col" role="dialog" aria-modal="true" aria-label={t("title")}>
      <div className="relative flex-1 overflow-hidden">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 w-full h-full object-cover" />
        {live ? (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-[82%] max-w-[520px] h-[34%] border-2 border-accent/80 rounded-lg shadow-[0_0_0_100vmax_rgba(0,0,0,0.45)]" />
          </div>
        ) : null}
        <p
          className="absolute left-0 right-0 top-0 px-4 py-3 text-white text-sm bg-black/50"
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}
        >
          {error ? t(`error.${error}`) : t("title")}
        </p>
      </div>
      <div className="p-4 bg-black text-white space-y-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}>
        <p className="text-[12px] text-white/70">{error ? t("manual") : t("hint")}</p>
        <button type="button" onClick={onClose} className="w-full h-12 rounded-md border border-white/40 text-sm font-medium">
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}
