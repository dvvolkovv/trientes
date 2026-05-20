# DNS, TLS, and OAuth callback wiring

## DNS (ionos)

Add two A-records on the `trientes.org` zone:
- `@` → `85.192.25.242`
- `www` → `85.192.25.242`

TTL 3600 is fine. Verify with `dig +short trientes.org`.

## TLS (Let's Encrypt via certbot)

```
sudo certbot --nginx -d trientes.org -d www.trientes.org --redirect
```

Cert is auto-renewed by the `certbot.timer` systemd unit. To verify renewal:
```
sudo certbot renew --dry-run
```

## OAuth callback URLs

After enabling HTTPS, update the following in each provider's developer console.

### Google
- Console: https://console.cloud.google.com/apis/credentials
- OAuth client → Authorized redirect URIs:
  - `https://trientes.org/api/auth/callback/google`

### GitHub
- Settings: https://github.com/settings/developers → OAuth Apps → trientes
- Authorization callback URL: `https://trientes.org/api/auth/callback/github`
- Homepage URL: `https://trientes.org`

### Telegram Login Widget (optional)
- BotFather: `/setdomain` then send `trientes.org`

## NEXTAUTH_URL

Server `.env` must read `NEXTAUTH_URL=https://trientes.org`.
