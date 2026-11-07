# PocketPass Wi-Fi Subscription Platform

This repository contains a runnable **development foundation** for a Tanzanian Wi-Fi subscription portal. It includes account signup/login, plan selection, payment status polling, PostgreSQL persistence, an idempotent payment-fulfillment transaction, a development-only fake payment confirmation, and a minimal FreeRADIUS-compatible SQL table subset.

It is not ready to take live payments or grant access on arbitrary routers yet. Provider signing and callback parsing are intentionally an adapter boundary, and router authorization is not automatic until a router integration (UAM, CoA, or vendor-specific API) is configured. Never use the mock payment driver in production.

## Run locally

Requirements: Docker Desktop with Compose. From this directory:

```sh
docker compose up --build
```

Open `http://localhost:3000/`. Create an account using a Tanzanian phone number (for example `+255712345678`) and a password of at least 10 characters. Select a plan, choose a wallet, and use the explicitly labeled **Demo only** button to exercise fulfillment. Local default credentials in `docker-compose.yml` are for development only.

The captive portal is served at `/` and `/portal.html`. The original PocketPass concept page is available at `/home`.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/plans` | Active subscription plans |
| POST | `/v1/auth/signup` | Create account (`phone`, `password`) |
| POST | `/v1/auth/login` | Log in; sets HttpOnly session cookie |
| POST | `/v1/auth/logout` | Clear session |
| GET | `/v1/me` | Current account and valid pass |
| POST | `/v1/payments` | Begin payment (`planId`, `phone`, `provider`) |
| GET | `/v1/payments/:id` | Poll payment state |
| POST | `/v1/webhooks/:provider` | Provider callback boundary |
| GET | `/captive-portal/api/:token` | RFC 8908 captive-state response |

The webhook route expects a provider adapter to verify the raw body and parse a final successful transaction into `{ status, transactionId, amount, currency, payload }`. It validates amount and currency again and fulfills a payment at most once. In the current scaffold, only the local mock adapter is implemented; the base provider adapter deliberately fails closed.

## RADIUS and router deployment

Expose RADIUS only on a private network or VPN. Register each NAS with a unique shared secret and allow UDP 1812/1813 only from its stable management address. Example FreeRADIUS `clients.conf` entry:

```text
client hotspot_site_01 {
    ipaddr = 10.20.0.2
    secret = REPLACE_WITH_A_LONG_UNIQUE_RANDOM_SECRET
    nas_type = other
}
```

Configure the router with the RADIUS server's reachable private address, authentication UDP/1812, accounting UDP/1813, and the matching secret. Enable accounting and the router's captive portal feature. Populate the NAS IP from the actual network; do not expose RADIUS directly to the public internet.

`server/schema.sql` includes a small SQL subset for local development, not a replacement for the schema shipped with the deployed FreeRADIUS version. Import the official PostgreSQL schema matching that version before production. The app currently does not insert RADIUS credentials, run authorization checks in FreeRADIUS, send CoA/Disconnect messages, or bind a purchased subscription to the captive client's MAC/IP. Those require an explicit integration. Human passwords are Argon2id hashes and must not be copied into `radcheck` as `Cleartext-Password`.

There is no vendor-neutral portal redirect or universal post-payment login API. Select one supported integration per network and implement an adapter that securely binds the portal session to the NAS-provided client identity. Do not trust a user-submitted MAC/IP, `userurl`, or query parameter as proof of identity. MAC randomization, IPv6, NAT, and multiple devices require deliberate handling.

## Captive portal discovery and walled garden

RFC 8910 DHCP option 114 should point to an HTTPS RFC 8908 API URI, for example `https://portal.example.tz/captive-portal/api/<opaque-client-token>`. The API response includes the user portal URL. The RFC endpoint is not the sign-in page itself.

For a captive client, allow only the portal hostname and any required API/assets hosts. Add a hosted checkout hostname only if that payment flow sends the phone's browser there. A server-to-server payment webhook does not belong in the client walled garden. Get current endpoint domains and any published IP ranges from your selected merchant provider; do not invent MNO gateway hostnames or hard-code dynamic third-party IPs. Use DNS-name matching where supported.

## Production checklist before live money or access

1. Obtain merchant credentials and confirm wallet collection for M-Pesa, Airtel Money, HaloPesa, and Mixx by Yas with your chosen provider. Provider access and operator codes depend on the merchant product/account.
2. Implement the provider-specific signed request and callback adapter, callback replay protection, timestamp window, transaction-status reconciliation, and failure/timeout handling. Keep secrets in a secrets manager.
3. Replace development secrets and credentials; use TLS, secure cookies, CSRF protection appropriate to deployment, database migrations, backups, monitoring, and a locked-down admin workflow.
4. Implement the chosen router adapter and RADIUS authorization/CoA behavior. Map bandwidth attributes per vendor; `MikroTik-Rate-Limit` is not a standard RADIUS attribute.
5. Use the official FreeRADIUS schema and test authentication, accounting, expiry, disconnection, duplicate callbacks, concurrent purchases, iOS CNA, Android captive login, IPv4/IPv6, and router reboot behavior in a lab.
6. Set real plan pricing, quotas, retention rules, privacy notice, support details, and applicable Tanzanian legal/accounting requirements before launch.
