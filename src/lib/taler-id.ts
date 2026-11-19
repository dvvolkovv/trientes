import type { OIDCConfig } from "next-auth/providers";

/**
 * Вход через Taler ID (OIDC, https://talerid.io/ui/oauth-guide.html).
 *
 * Издатель — прод `api.talerid.io`: адреса берутся из его discovery, а `iss`
 * в ответе авторизации сверяется с ним же. У `id.taler.tirol` издатель другой,
 * поэтому весь вход идёт через один хост.
 */
export const TALER_ID_ISSUER = "https://api.talerid.io/oauth";

/**
 * Только набор по умолчанию: самозаведённый клиент получает ровно его, а
 * `phone`, `kyc`, `wallet` Taler ID отклонит, хоть они и есть в discovery.
 */
const SCOPE = "openid profile email";

export type TalerIdProfile = {
  sub: string;
  name?: string | null;
  email?: string | null;
  email_verified?: boolean;
};

/**
 * Провайдер Taler ID; null — клиент не заведён, и кнопки входа нет.
 *
 * Профиль читается из `/oauth/me`, а не из id_token: Taler ID кладёт имя и
 * почту только в userinfo, в id_token при `response_type=code` один `sub`.
 *
 * Почта берётся, только если Taler ID её подтвердил. Неподтверждённая почта
 * могла бы привязать чужой аккаунт с тем же адресом (связывание по почте
 * включено) или дать роль владельца через `ADMIN_WHITELIST`, поэтому такой
 * человек получает аккаунт без почты.
 */
export function talerIdProvider(
  env: Record<string, string | undefined> = process.env,
): OIDCConfig<TalerIdProfile> | null {
  const clientId = env.TALERID_CLIENT_ID?.trim();
  const clientSecret = env.TALERID_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return {
    id: "talerid",
    name: "Taler ID",
    type: "oidc",
    issuer: TALER_ID_ISSUER,
    clientId,
    clientSecret,
    authorization: { params: { scope: SCOPE } },
    checks: ["pkce", "state", "nonce"],
    idToken: false,
    allowDangerousEmailAccountLinking: true,
    profile(profile) {
      const email =
        profile.email_verified === true && profile.email ? profile.email.toLowerCase() : null;
      return { id: profile.sub, name: profile.name ?? null, email, image: null };
    },
  };
}
