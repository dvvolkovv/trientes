"use client";

/**
 * Шапка профиля (слайс BT): аватар, имя по центру, `@имя-входа`, под ним почта и
 * телефон. Просьба владельца дословно — «чтобы по центру было написано фамилия
 * имя и чтобы аватарку можно было приклеить».
 *
 * Строка «это видим только мы» стоит не для красоты: публичной страницы человека
 * в проекте нет, наружу он виден именем входа, и молчание об этом создавало бы
 * впечатление в обе стороны (то же решение, что у политики возврата в BN).
 */

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { removeAvatar } from "@/app/actions/account";

export function ProfileHeader({
  name,
  username,
  email,
  emailVerified,
  phone,
  image,
}: {
  name: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  image: string | null;
}) {
  const t = useTranslations("cabinet.profile");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initial = (name.trim()[0] ?? username[0] ?? "?").toUpperCase();

  async function upload(file: File) {
    setError(null);
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/account/avatar", { method: "POST", body });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        const code = json?.error ?? "upload_failed";
        setError(t.has(`avatar.errors.${code}`) ? t(`avatar.errors.${code}`) : t("avatar.errors.upload_failed"));
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-[22px] border border-hairline bg-card px-4 py-7 text-center">
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        aria-label={t("avatar.change")}
        className="relative h-24 w-24 overflow-hidden rounded-full border border-hairline bg-card-alt transition-colors hover:border-accent/60 disabled:opacity-50"
      >
        {image ? (
          // Обычный <img>: снимок бывает и с чужого хоста (Google, GitHub), а
          // настраивать под каждый такой хост загрузчик картинок Next незачем.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[34px] font-bold text-muted">
            {initial}
          </span>
        )}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file);
        }}
      />
      <div className="flex flex-wrap items-center justify-center gap-3 text-[13px]">
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className="font-semibold text-accent disabled:opacity-50"
        >
          {busy ? t("avatar.uploading") : image ? t("avatar.change") : t("avatar.add")}
        </button>
        {image ? (
          <button
            type="button"
            disabled={pending || busy}
            onClick={() =>
              start(async () => {
                await removeAvatar();
                router.refresh();
              })
            }
            className="text-muted disabled:opacity-50"
          >
            {t("avatar.remove")}
          </button>
        ) : null}
      </div>
      {error ? <p className="text-sm text-red-500">{error}</p> : null}

      <h2 className="text-[26px] font-bold leading-tight tracking-[-0.02em]">{name}</h2>
      <div className="num text-[13px] text-muted">@{username}</div>

      <div className="flex flex-col items-center gap-1 text-[14px]">
        <div>
          {email ? (
            <>
              {email}
              {emailVerified ? <span className="ml-1 text-green-500">✓</span> : null}
            </>
          ) : (
            <span className="text-muted">{t("noEmail")}</span>
          )}
        </div>
        <div>{phone ? phone : <span className="text-muted">{t("noPhone")}</span>}</div>
      </div>
      <p className="max-w-[46ch] text-[12px] leading-snug text-muted">{t("privateNote")}</p>
    </div>
  );
}
