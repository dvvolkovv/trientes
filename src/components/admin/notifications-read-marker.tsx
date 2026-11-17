"use client";

import { useEffect } from "react";
import { markNotificationsRead } from "@/app/actions/case-messages";

/** Список открыли — колокольчики погасли. Как и в нитке, из эффекта. */
export function NotificationsReadMarker() {
  useEffect(() => {
    void markNotificationsRead();
  }, []);
  return null;
}
