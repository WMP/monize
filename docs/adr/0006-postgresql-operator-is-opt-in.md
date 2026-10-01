# 0006. The chart can request PostgreSQL from an operator, opt-in and never by default

Status: accepted
Date: 2026-10-01

## Context

The Helm chart has never run PostgreSQL. The operator of a deployment brought a
database, pointed `backend.database.DATABASE_HOST` at it and passed the
credentials through `backend.extraEnvFrom`. The reference deployment does this
against a CloudNativePG cluster (`home-rw`), and `docs/future-plans/horizontal-scaling.md`
puts a PostgreSQL high-availability topology out of scope as "the operator's
database, not this application".

Two things changed that. `CLUSTER_MODE=multi` (ADR 0005) made several backend
replicas correct, which moves the single point of failure to the one database
every replica shares. And the two operators people run for an available
PostgreSQL on Kubernetes -- CloudNativePG and Zalando's postgres-operator, which
runs Patroni -- both reduce that database to one custom resource. Writing that
resource by hand, and then wiring the backend to the Service and Secret names
the operator derives from it, is where installs went wrong: the wrong Service
(a transaction-mode pooler cannot hold the `LISTEN` multi needs), the wrong
Secret key, TLS left off.

Three facts about the backend shaped what the chart could do:

- The startup scripts (`db-init`, `db-migrate`, the demo check) opened their own
  `pg.Client` and ignored `DATABASE_SSL`. The Zalando operator's Spilo image
  refuses non-TLS connections in its default `pg_hba`, so against it the
  container crash-looped before the application started.
- The only way to trust a private CA was `NODE_EXTRA_CA_CERTS`, which trusts it
  for every TLS connection the process makes -- SMTP, S3, OIDC -- not only the
  database.
- The RLS runtime role (`monize_app`) is created by `db-init` only when the
  owner has `CREATEROLE`. CloudNativePG's owner does not; Zalando generates role
  passwords itself and cannot take one from us.

## Decision

**`postgresql.provider` chooses who runs the database: `external` (the default),
`cnpg` or `zalando`.** With an operator the chart renders that operator's custom
resource (`Cluster` or `postgresql`) and derives everything the backend needs
from it: `DATABASE_HOST` (the primary Service, `<clusterName>-rw` or
`<clusterName>`), `DATABASE_NAME`, the credentials (a `secretKeyRef` into the
Secret the operator creates), TLS, and the RLS runtime role.

**The default stays `external`.** An operator is a cluster-wide installation with
CRDs; a default that needs one fails `helm install` on every cluster that does
not have it, and an upgrade of an existing release under a new default would
create a second, empty database beside the one that holds the data. Choosing an
operator is therefore an explicit act, and either operator is a first-class
choice: the chart does not rank them.

**The chart renders the resource, never the operator.** Installing, upgrading
and configuring CloudNativePG or the Zalando operator stays with the cluster's
owner.

**The database outlives the release.** The custom resource carries
`helm.sh/resource-policy: keep`, as the backend's claims already do: neither
`helm uninstall` nor a change of provider deletes a database.

**One source per setting.** With an operator selected, the chart refuses to render
when `backend.database.DATABASE_HOST` or `DATABASE_NAME` is also set, rather
than pointing one database's credentials at another.

**Every direct connection reads one TLS function.** `resolveDatabaseSsl`
(`backend/src/common/db/database-ssl.ts`) serves the pool, the `LISTEN` client
and every startup script, and a source-scanning guard fails any new `Client`,
`Pool` or `DataSource` that does not use it. `DATABASE_SSL_CA_FILE` gives the
database connections, and only those, a CA to verify against.

**TLS is on with either operator.** With CloudNativePG the chart verifies the
server certificate against the operator's `<clusterName>-ca`, projecting only
`ca.crt` into the pod. With Zalando the connection is encrypted and, unless
`postgresql.tls.caSecret` names a CA, not verified: Spilo's default certificate
is self-signed and the operator publishes no CA for it.

**The RLS role follows each operator's model.** CloudNativePG declares it in
`spec.managed.roles` with the attributes of `APP_ROLE_ATTRIBUTES` and a password
Secret the operator of the deployment supplies. Zalando gives the owner
`CREATEROLE`, and `db-init` creates the role with Monize's own attribute list,
the same path the Compose deployment takes.

## Consequences

**An available database is a values change.** `postgresql.provider: cnpg` (or
`zalando`) with `cluster.mode: multi` is a deployment with no single pod whose
loss stops the service, without hand-written manifests in between.

**Two operators are two code paths in the chart**, each with its own Service and
Secret names, TLS model and role model, and each must be re-checked when that
operator changes them. `helm/README.md` records the versions the paths were
tested against.

**The chart configures no database backup.** Monize's own backups are per-user
artifacts, not point-in-time recovery. WAL archiving belongs to the operator and
is passed through `postgresql.cnpg.spec` or `postgresql.zalando.spec`; the README
says so where the provider is chosen.

**Moving an existing database under an operator is a migration, not an
upgrade.** Changing the provider creates an empty database; the data moves with
`pg_dump` and `pg_restore` while the backend is scaled to zero.

**Zalando cannot run in the namespace this chart creates at its default Pod
Security level.** The `restricted` standard needs a seccomp profile, all
capabilities dropped and `allowPrivilegeEscalation: false`; the operator sets the
first two on no Spilo pod and allows escalation by default. The chart refuses
that combination instead of rendering a StatefulSet that never creates a pod,
and the Zalando path runs at `baseline`.

**A deployment that set `DATABASE_SSL=true` against a TLS-only server now starts.**
That was a defect of the startup scripts, independent of any operator.

## Alternatives considered

**Zalando as the default provider.** Patroni is a mature failover engine and the
reason this option was asked for. Rejected as a *default* for the two reasons in
the Decision -- a CRD every cluster would need, and an upgrade that silently
creates an empty second database -- not as a choice: `zalando` is one value away.

**Installing the operator as a subchart.** Operators are cluster-scoped: one
installation, its CRDs and its RBAC serve every namespace. A copy per application
release would conflict with the next one, and Helm does not upgrade CRDs it
installed. Rejected.

**A bundled single-instance PostgreSQL subchart.** It gives a database without an
operator, but not failover, which is the reason to want one, and adds an image
supply chain to track. Rejected.

**`NODE_EXTRA_CA_CERTS` for the database CA.** It works without a backend change,
and it makes a CA whose private key lives in the cluster trusted for the
backend's external TLS as well. Rejected for `DATABASE_SSL_CA_FILE`, scoped to
the database connections.

**Allowing `DATABASE_HOST` beside an operator**, for example to reach a pooler.
It would route the operator's credentials to whatever the host names, and a
transaction-mode pooler cannot carry `LISTEN`. Rejected; a deployment that needs
its own endpoint uses `provider: external` and wires it by hand, as before.

**Turning Zalando's pod hardening on from the chart.** The `postgresql` resource
has no field for a seccomp profile or dropped capabilities, and
`spilo_allow_privilege_escalation` is operator-wide configuration. Only a policy
engine that mutates the pods could make them meet `restricted`. Rejected; the
chart refuses the combination and names both ways out.
