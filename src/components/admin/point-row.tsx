"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approvePoint, rejectPoint } from "@/app/actions/admin-points";

export type PointRowData = {
  id: string;
  type: string;
  name: string;
  description: string | null;
  lat: number;
  lon: number;
  address: string | null;
  acceptedCoinIds: string[];
  status: string;
  rejectReason: string | null;
  createdAt: string;
  companyName: string;
  website: string | null;
};

export function PointRow({ row }: { row: PointRowData }) {
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const act = (fn: () => Promise<{ ok: boolean; reason?: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (res.ok) router.refresh();
      else setError(res.reason ?? "unknown_error");
    });

  return (
    <div className="bg-card border border-hairline rounded-[16px] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">
            {row.name}{" "}
            <span className="num text-[11px] text-muted">· {row.type}</span>
          </div>
          <div className="text-[13px] text-muted">{row.companyName}</div>
          {row.address && (
            <div className="text-[12px] text-muted">{row.address}</div>
          )}
          <div className="num text-[11px] text-muted">
            {row.lat.toFixed(5)}, {row.lon.toFixed(5)}
          </div>
          {row.acceptedCoinIds.length > 0 && (
            <div className="text-[11px] text-muted mt-1">
              coins: {row.acceptedCoinIds.join(", ")}
            </div>
          )}
          <a
            className="text-[12px] text-accent"
            target="_blank"
            rel="noopener noreferrer"
            href={`https://www.openstreetmap.org/?mlat=${row.lat}&mlon=${row.lon}#map=17/${row.lat}/${row.lon}`}
          >
            preview on map ↗
          </a>
        </div>
        {row.status === "PENDING" && (
          <div className="flex flex-col gap-2 shrink-0">
            <button
              type="button"
              disabled={pending}
              onClick={() => act(() => approvePoint({ pointId: row.id }))}
              className="text-[12px] px-3 py-1.5 rounded-md bg-up/15 text-up font-medium"
            >
              Approve
            </button>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="reject reason"
              className="text-[12px] bg-bg-tint border border-hairline rounded-md px-2 py-1"
            />
            <button
              type="button"
              disabled={pending || reason.trim().length < 3}
              onClick={() =>
                act(() => rejectPoint({ pointId: row.id, rejectReason: reason }))
              }
              className="text-[12px] px-3 py-1.5 rounded-md bg-down/15 text-down font-medium"
            >
              Reject
            </button>
          </div>
        )}
      </div>
      {row.status === "REJECTED" && row.rejectReason && (
        <div className="text-[12px] text-down mt-2">
          Rejected: {row.rejectReason}
        </div>
      )}
      {error && <div className="text-[12px] text-down mt-2">Error: {error}</div>}
    </div>
  );
}
