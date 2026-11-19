"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { archiveWarehouse, restoreWarehouse } from "@/app/actions/warehouses";

/** Склад не удаляется, а архивируется: движения по нему уже записаны. */
export function ArchiveWarehouseButton({
  companyId,
  warehouseId,
  archived,
}: {
  companyId: string;
  warehouseId: string;
  archived: boolean;
}) {
  const t = useTranslations("warehouses");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const r = archived
              ? await restoreWarehouse(companyId, warehouseId)
              : await archiveWarehouse(companyId, warehouseId);
            if (r.ok) router.refresh();
            else setError(r.reason);
          });
        }}
        className="h-12 px-4 rounded-md border border-hairline text-sm disabled:opacity-50"
      >
        {archived ? t("restore") : t("archive")}
      </button>
      {error ? <p className="text-[13px] text-red-500 mt-1">{t(`error.${error}`)}</p> : null}
    </div>
  );
}
