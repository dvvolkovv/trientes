"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { resetSectionColors } from "@/app/actions/admin-appearance";
import { ADMIN_BUTTON_SECONDARY } from "@/lib/admin-ui";

export function ResetColorsButton({ label }: { label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await resetSectionColors();
          router.refresh();
        })
      }
      className={ADMIN_BUTTON_SECONDARY}
    >
      {label}
    </button>
  );
}
