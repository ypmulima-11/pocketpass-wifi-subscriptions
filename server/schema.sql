CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 text UNIQUE NOT NULL CHECK (phone_e164 ~ '^\\+255[0-9]{9}$'),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plans (
  id text PRIMARY KEY,
  name text NOT NULL,
  price_tzs integer NOT NULL CHECK (price_tzs > 0),
  duration_seconds integer NOT NULL CHECK (duration_seconds > 0),
  quota_bytes bigint,
  rate_limit text,
  active boolean NOT NULL DEFAULT true
);

INSERT INTO plans (id,name,price_tzs,duration_seconds,quota_bytes,rate_limit) VALUES
 ('3h','3 Hours',500,10800,536870912,'2M/2M'),
 ('24h','24 Hours',1500,86400,2147483648,'4M/4M'),
 ('7d','7 Days',7000,604800,10737418240,'8M/8M'),
 ('30d','30 Days',25000,2592000,53687091200,'10M/10M')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  plan_id text NOT NULL REFERENCES plans(id),
  starts_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('active','expired','revoked')),
  source_payment_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscriptions_current ON subscriptions(user_id,expires_at DESC) WHERE status='active';

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  plan_id text NOT NULL REFERENCES plans(id),
  provider text NOT NULL,
  provider_tx_id text UNIQUE NOT NULL,
  provider_reference text UNIQUE,
  phone_e164 text NOT NULL,
  amount_tzs integer NOT NULL,
  currency char(3) NOT NULL DEFAULT 'TZS',
  status text NOT NULL CHECK (status IN ('pending','paid','failed','expired')) DEFAULT 'pending',
  provider_payload jsonb,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS portal_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text UNIQUE NOT NULL,
  nas_identifier text,
  client_ip inet,
  client_mac macaddr,
  original_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

-- Standard FreeRADIUS SQL tables: use the schema shipped with your deployed
-- FreeRADIUS release in production. This compact subset is for local wiring only.
CREATE TABLE IF NOT EXISTS radcheck (
  id bigserial PRIMARY KEY, username text NOT NULL DEFAULT '', attribute text NOT NULL DEFAULT '',
  op char(2) NOT NULL DEFAULT ':=', value text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS radcheck_username ON radcheck(username);
CREATE TABLE IF NOT EXISTS radreply (
  id bigserial PRIMARY KEY, username text NOT NULL DEFAULT '', attribute text NOT NULL DEFAULT '',
  op char(2) NOT NULL DEFAULT ':=', value text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS radreply_username ON radreply(username);
CREATE TABLE IF NOT EXISTS radacct (
  radacctid bigserial PRIMARY KEY, acctsessionid text NOT NULL DEFAULT '', acctuniqueid text NOT NULL UNIQUE DEFAULT '',
  username text NOT NULL DEFAULT '', realm text NOT NULL DEFAULT '', nasipaddress inet NOT NULL,
  nasportid text, nasporttype text, acctstarttime timestamptz, acctupdatetime timestamptz,
  acctstoptime timestamptz, acctsessiontime bigint, acctauthentic text, connectinfo_start text,
  connectinfo_stop text, acctinputoctets bigint, acctoutputoctets bigint, calledstationid text,
  callingstationid text, acctterminatecause text, servicetype text, framedprotocol text,
  framedipaddress inet, framedipv6address inet, framedipv6prefix inet, framedinterfaceid text,
  delegatedipv6prefix inet
);
CREATE INDEX IF NOT EXISTS radacct_active_idx ON radacct(acctuniqueid) WHERE acctstoptime IS NULL;
