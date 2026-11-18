"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { findProductByGtin } from "@/app/actions/products";
import { BarcodeScanButton } from "@/components/barcode/scan-button";

/**
 * Поиск паспорта камерой: человек стоит в магазине с товаром в руках, и тринадцать цифр
 * с упаковки набирать ему незачем. Снятый код ведёт прямо в паспорт; паспорта нет —
 * говорим это кодом, а не пустым списком поиска.
 */
export function ProductBarcodeSearch({ locale }: { locale: string }) {
  const t = useTranslations("products");
  const router = useRouter();
  const [missing, setMissing] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-2 w-full md:w-auto">
      <BarcodeScanButton
        onCode={(code) =>
          start(async () => {
            setMissing(null);
            const r = await findProductByGtin(code);
            if (r.ok && r.product) {
              router.push(`/${locale}/product/${r.product.slug}`);
              return;
            }
            setMissing(code);
          })
        }
      />
      {pending ? <p className="text-[12px] text-muted">{t("scanLooking")}</p> : null}
      {missing ? (
        <p className="text-[13px]">
          {t("scanNotFound", { code: missing })}{" "}
          <Link href={`/${locale}/cabinet`} className="text-accent">
            {t("scanCreate")}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
