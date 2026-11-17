"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setUserRole } from "@/app/actions/admin-users";

export function UserRoleToggle({
  userId,
  currentRole,
}: {
  userId: string;
  currentRole: "USER" | "STAFF" | "OWNER" | "ADMIN";
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  // Переключатель про владение, а не про работу: права сотрудника выдаются по
  // очередям на /admin/staff. ADMIN — наследие, читается как владелец.
  const isOwner = currentRole === "OWNER" || currentRole === "ADMIN";
  const next = isOwner ? "USER" : "OWNER";
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        start(async () => {
          await setUserRole({ userId, role: next });
          router.refresh();
        });
      }}
      className={
        isOwner
          ? `border border-hairline text-foreground hover:bg-card-alt px-3 py-1.5 text-xs uppercase tracking-wider rounded-md ${pending ? "opacity-50" : ""}`
          : `bg-accent text-accent-foreground px-3 py-1.5 text-xs uppercase tracking-wider rounded-md font-semibold hover:brightness-110 ${pending ? "opacity-50" : ""}`
      }
    >
      {isOwner ? "Demote" : "Promote"}
    </button>
  );
}
