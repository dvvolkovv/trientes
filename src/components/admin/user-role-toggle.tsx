"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { setUserRole } from "@/app/actions/admin-users";

export function UserRoleToggle({
  userId,
  currentRole,
}: {
  userId: string;
  currentRole: "USER" | "ADMIN";
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const next = currentRole === "ADMIN" ? "USER" : "ADMIN";
  return (
    <Button
      size="sm"
      variant={currentRole === "ADMIN" ? "outline" : "default"}
      disabled={pending}
      onClick={() => {
        start(async () => {
          await setUserRole({ userId, role: next });
          router.refresh();
        });
      }}
    >
      {currentRole === "ADMIN" ? "Demote" : "Promote"}
    </Button>
  );
}
