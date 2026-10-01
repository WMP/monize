{{/*
Expand the name of the chart.
*/}}
{{- define "monize.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "monize.fullname" -}}
{{- default .Release.Name .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Chart label values.
*/}}
{{- define "monize.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Resolve the application hostname.
Defaults to monize.<global.domain>
*/}}
{{- define "monize.hostname" -}}
{{- if .Values.global.hostname }}
{{- .Values.global.hostname }}
{{- else }}
{{- printf "monize.%s" .Values.global.domain }}
{{- end }}
{{- end }}

{{/*
Resolve the public app URL.
Defaults to https://<hostname>
*/}}
{{- define "monize.publicAppUrl" -}}
{{- printf "https://%s" (include "monize.hostname" .) }}
{{- end }}

{{/*
Resolve the OIDC issuer URL.
Defaults to https://auth.<global.domain>
*/}}
{{- define "monize.oidcIssuerUrl" -}}
{{- if .Values.backend.oidc.OIDC_ISSUER_URL }}
{{- .Values.backend.oidc.OIDC_ISSUER_URL }}
{{- else }}
{{- printf "https://auth.%s" .Values.global.domain }}
{{- end }}
{{- end }}

{{/*
Resolve the OIDC callback URL.
Defaults to https://<hostname>/api/v1/auth/oidc/callback
*/}}
{{- define "monize.oidcCallbackUrl" -}}
{{- if .Values.backend.oidc.OIDC_CALLBACK_URL }}
{{- .Values.backend.oidc.OIDC_CALLBACK_URL }}
{{- else }}
{{- printf "https://%s/api/v1/auth/oidc/callback" (include "monize.hostname" .) }}
{{- end }}
{{- end }}

{{/*
Resolve the internal API URL for the frontend.
Defaults to http://monize-backend-service:<backend.service.port>
*/}}
{{- define "monize.internalApiUrl" -}}
{{- if .Values.frontend.app.INTERNAL_API_URL }}
{{- .Values.frontend.app.INTERNAL_API_URL }}
{{- else }}
{{- printf "http://monize-backend-service:%v" (.Values.backend.service.port | int) }}
{{- end }}
{{- end }}

{{/*
Common labels for backend resources.
*/}}
{{- define "monize.backend.labels" -}}
app: monize-backend
app.kubernetes.io/name: monize-backend
app.kubernetes.io/version: {{ .Values.backend.image.tag | quote }}
app.kubernetes.io/component: backend
app.kubernetes.io/part-of: monize
helm.sh/chart: {{ include "monize.chart" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels for backend.
*/}}
{{- define "monize.backend.selectorLabels" -}}
app: monize-backend
{{- end }}

{{/*
Common labels for frontend resources.
*/}}
{{- define "monize.frontend.labels" -}}
app: monize-frontend
app.kubernetes.io/name: monize-frontend
app.kubernetes.io/version: {{ .Values.frontend.image.tag | quote }}
app.kubernetes.io/component: frontend
app.kubernetes.io/part-of: monize
helm.sh/chart: {{ include "monize.chart" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels for frontend.
*/}}
{{- define "monize.frontend.selectorLabels" -}}
app: monize-frontend
{{- end }}

{{/*
The configured attachment storage provider, read out of backend.extraEnv so
NOTES.txt can warn when "local" has no volume behind it. Defaults to "database",
matching the backend's own default.
*/}}
{{- define "monize.attachmentProvider" -}}
{{- $provider := "database" -}}
{{- range .Values.backend.extraEnv -}}
{{- if eq .name "ATTACHMENT_STORAGE_PROVIDER" -}}
{{- $provider = .value | default "database" -}}
{{- end -}}
{{- end -}}
{{- $provider | lower -}}
{{- end -}}

{{/*
The configured backup storage target, read out of backend.extraEnv the same way
the attachment provider is, so NOTES.txt and the shared-volume warnings can tell
a local store (which needs a volume every replica mounts) from an s3 one (which
every replica reaches by construction). Defaults to "local", matching the
backend's own default in every cluster mode.
*/}}
{{- define "monize.backupStore" -}}
{{- $store := "local" -}}
{{- range .Values.backend.extraEnv -}}
{{- if eq .name "BACKUP_STORAGE_PROVIDER" -}}
{{- $store = .value | default "local" -}}
{{- end -}}
{{- end -}}
{{- $store | lower -}}
{{- end -}}

{{/*
Whether a value means "true", tested exactly rather than for truthiness.

A plain `if` on cluster.backupSharedVolume is true for the *string* "false",
which is what `--set cluster.backupSharedVolume=false` produces under some
wrappers and what a values file writes when the key is quoted. The one place
that matters most is an assertion the backend cannot verify: emitting
BACKUP_SHARED_VOLUME=true because the operator wrote "false" would turn a boot
refusal into two replicas quietly writing backups to two different disks.

Called through `include` and compared to the string "true" by every caller.
*/}}
{{- define "monize.isTrue" -}}
{{- if kindIs "bool" . -}}
{{- if . }}true{{ end -}}
{{- else -}}
{{- if eq (lower (toString (default "" .))) "true" }}true{{ end -}}
{{- end -}}
{{- end -}}

{{/*
Whether CLUSTER_MODE is multi.
*/}}
{{- define "monize.clusterMulti" -}}
{{- if eq (lower (toString (.Values.cluster.mode | default "single"))) "multi" }}true{{ end -}}
{{- end -}}

{{/*
A topologySpreadConstraint whose labelSelector matches no pod is not a weaker
constraint -- it is no constraint at all, satisfied by any placement, including
every replica on one node. The chart's own example used
`app.kubernetes.io/name: monize` while the pod template carries
`app.kubernetes.io/name: monize-backend`, which renders, installs and schedules
cleanly while doing nothing.

So every matchLabels key/value here must be one the pod template actually
carries. matchExpressions are passed through unchecked: their semantics are
richer than a subset test, and an operator writing one is past the mistake this
guards.

Usage: include "monize.assertSpreadSelectors" (dict "constraints" ... "podLabels" ... "path" "backend")
*/}}
{{- define "monize.assertSpreadSelectors" -}}
{{- $podLabels := .podLabels -}}
{{- $path := .path -}}
{{- range $i, $constraint := .constraints -}}
{{- $selector := $constraint.labelSelector | default dict -}}
{{- $matchLabels := $selector.matchLabels | default dict -}}
{{- if and (not $matchLabels) (not $selector.matchExpressions) -}}
{{- fail (printf "%s.topologySpreadConstraints[%d] has no labelSelector: a constraint that selects no pods is satisfied by every placement, including all replicas on one node. Select the pods this workload creates, e.g. matchLabels: {app: %s}." $path $i (index $podLabels "app")) -}}
{{- end -}}
{{- range $key, $value := $matchLabels -}}
{{- $actual := index $podLabels $key -}}
{{- if ne (toString $value) (toString ($actual | default "")) -}}
{{- fail (printf "%s.topologySpreadConstraints[%d] selects %s=%s, but this workload's pods are labelled %s=%s. A selector that matches no pod imposes no spread at all; the replicas may all land on one node with the constraint reported as satisfied." $path $i $key (toString $value) $key (toString ($actual | default "<absent>"))) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
CLUSTER_MODE=single means the backend keeps rate-limit counters, single-use
claims and the relay's wake-ups inside one process. A second replica does not
share them: every @Throttle cap is enforced once per pod, and an SSE stream on
one pod never hears the answer produced on the other. Nothing inside a replica
can detect the second one, so this is the only place it can be refused -- and
it is refused here rather than warned about, because the failure mode is a rate
limit that is silently twice what it says.

Only the backend is checked. The frontend is stateless per request and scales
freely at either mode.
*/}}
{{- define "monize.assertClusterMode" -}}
{{- if not (include "monize.clusterMulti" .) -}}
{{- $autoscaling := .Values.backend.autoscaling | default dict -}}
{{- if gt (int .Values.backend.replicas) 1 -}}
{{- fail (printf "backend.replicas is %d with cluster.mode=single. A second backend replica does not share rate-limit counters, single-use claims or relay wake-ups with the first, so limits are enforced per pod and AI answers are lost when the two halves of a conversation land differently. Set cluster.mode=multi (and read its notes on DATABASE_HOST and shared storage), or keep one replica." (int .Values.backend.replicas)) -}}
{{- end -}}
{{- if (include "monize.isTrue" $autoscaling.enabled) -}}
{{- if gt (int ($autoscaling.maxReplicas | default 1)) 1 -}}
{{- fail (printf "backend.autoscaling.maxReplicas is %d with cluster.mode=single. The autoscaler would scale past one backend replica under load -- exactly when a doubled rate limit matters most -- and nothing inside a pod can detect the second one. Set cluster.mode=multi, or cap maxReplicas at 1." (int ($autoscaling.maxReplicas | default 1))) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Which database the backend is wired to: "external" (the default -- the operator
of this chart runs one and says where), "cnpg" or "zalando". Lower-cased so
`--set postgresql.provider=CNPG` means what it says; assertPostgresql refuses
whatever is still none of the three.

Read through `default dict` because a release upgraded with --reuse-values
carries the values of the chart that installed it, which have no postgresql
block at all, and a release like that is an external one.
*/}}
{{- define "monize.postgresProvider" -}}
{{- $pg := .Values.postgresql | default dict -}}
{{- $pg.provider | default "external" | toString | lower -}}
{{- end -}}

{{/*
Whether an operator runs the database: "true" for cnpg and zalando, empty for
external. Every managed-only line in the backend's ConfigMap and Deployment
hangs off this one test, so the two never disagree about which mode they are in.
*/}}
{{- define "monize.postgresManaged" -}}
{{- $provider := include "monize.postgresProvider" . -}}
{{- if or (eq $provider "cnpg") (eq $provider "zalando") }}true{{ end -}}
{{- end -}}

{{/*
The host the backend connects to.

Managed: the operator's read-write Service, which always points at the primary.
CNPG names it "<clusterName>-rw"; Zalando names the master Service after the
cluster itself. Never a replica Service and never a pooler, because
cluster.mode=multi holds a LISTEN open on every replica and needs a direct
session to the primary.

A short name on purpose. The Service is in this release's namespace, and the
backend pod's dnsConfig sets ndots:1, so a name with no dot goes through the
search list, whose first entry is this namespace's own .svc domain: it resolves
on the first query. A "<service>.<namespace>" spelling has a dot, is tried as an
absolute name first and fails once before the search list finds it. CNPG's
server certificate lists the short Service name among its names, so verifying it
still matches.

External: backend.database.DATABASE_HOST, exactly as before.
*/}}
{{- define "monize.databaseHost" -}}
{{- $pg := .Values.postgresql | default dict -}}
{{- $provider := include "monize.postgresProvider" . -}}
{{- if eq $provider "cnpg" -}}
{{- printf "%s-rw" ($pg.clusterName | toString) -}}
{{- else if eq $provider "zalando" -}}
{{- $pg.clusterName | toString -}}
{{- else -}}
{{- .Values.backend.database.DATABASE_HOST -}}
{{- end -}}
{{- end -}}

{{/*
The database name: the one the operator is asked to create when managed (so the
resource and the backend read one value), backend.database.DATABASE_NAME
otherwise.
*/}}
{{- define "monize.databaseName" -}}
{{- $pg := .Values.postgresql | default dict -}}
{{- if include "monize.postgresManaged" . -}}
{{- $pg.database | toString -}}
{{- else -}}
{{- .Values.backend.database.DATABASE_NAME -}}
{{- end -}}
{{- end -}}

{{/*
The Secret the operator creates for the owner role, which holds the keys
"username" and "password" and is what DATABASE_USER and DATABASE_PASSWORD are read
from. Empty for external, where the credentials are whatever the operator of this
chart supplies through backend.extraEnv or backend.extraEnvFrom.

cnpg:    "<clusterName>-app", created for the owner of bootstrap.initdb.
zalando: "<owner>.<clusterName>.credentials.postgresql.acid.zalan.do", the
         operator's default secret_name_template. The operator writes the role
         into the name with every "_" replaced by "-", because a Kubernetes
         object name cannot hold an underscore
         (credentialSecretNameForCluster in pkg/cluster/util.go), so the same
         replacement is made here. An operator configured with another
         secret_name_template names the Secret differently, and the backend pod
         then waits for one that never appears.

Neither exists when the chart is installed. The operator creates it a few
seconds later, and the backend pod waits for it (see deployment-backend.yaml).
*/}}
{{- define "monize.databaseCredentialsSecret" -}}
{{- $pg := .Values.postgresql | default dict -}}
{{- $provider := include "monize.postgresProvider" . -}}
{{- if eq $provider "cnpg" -}}
{{- printf "%s-app" ($pg.clusterName | toString) -}}
{{- else if eq $provider "zalando" -}}
{{- printf "%s.%s.credentials.postgresql.acid.zalan.do" (replace "_" "-" ($pg.owner | toString)) ($pg.clusterName | toString) -}}
{{- end -}}
{{- end -}}

{{/*
The Secret holding the CA that signed the database's server certificate, or empty
when there is none to verify against. Empty for external, whatever tls says: the
backend is only wired to a CA for a database this chart set up.

postgresql.tls.caSecret when set. Otherwise CNPG's own "<clusterName>-ca", which
exists for every Cluster and signs its server certificate, so the connection is
verified with nothing configured. Zalando has no such Secret -- Spilo's
certificate is self-signed -- so the answer is empty and the connection is
encrypted but not verified.
*/}}
{{- define "monize.databaseCaSecret" -}}
{{- if include "monize.postgresManaged" . -}}
{{- $pg := .Values.postgresql | default dict -}}
{{- $tls := $pg.tls | default dict -}}
{{- if $tls.caSecret -}}
{{- $tls.caSecret -}}
{{- else if eq (include "monize.postgresProvider" .) "cnpg" -}}
{{- printf "%s-ca" ($pg.clusterName | toString) -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Where the database CA is mounted in the backend pod. The ConfigMap's
DATABASE_SSL_CA_FILE and the Deployment's volume mount are two halves of one
fact -- the backend is told to read a file, and the file has to be there -- so
the directory is written once, here. The file inside it is always ca.crt: the
Deployment projects the Secret's postgresql.tls.caKey to that name.
*/}}
{{- define "monize.databaseCaDir" -}}
/etc/monize/database-ca
{{- end -}}

{{/*
Common labels for the PostgreSQL operator resource.
*/}}
{{- define "monize.postgresql.labels" -}}
app: monize-postgresql
app.kubernetes.io/name: monize-postgresql
app.kubernetes.io/component: database
app.kubernetes.io/part-of: monize
helm.sh/chart: {{ include "monize.chart" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Every configuration of postgresql.* that Kubernetes would accept and that is
wrong, refused at render time. Each one is a database that installs cleanly and
then fails somewhere else -- in the operator's log, in the backend's boot, or
only when the role that should have been unprivileged turns out to own the
tables -- so the message says what is wrong, why it matters and what to set.

Called from configmap-backend.yaml, which every render includes, so it runs
whichever templates are being shown.
*/}}
{{- define "monize.assertPostgresql" -}}
{{- $pg := .Values.postgresql | default dict -}}
{{- $provider := include "monize.postgresProvider" . -}}
{{- if not (has $provider (list "external" "cnpg" "zalando")) -}}
{{- fail (printf "postgresql.provider is %q, which is none of external, cnpg or zalando. The chart cannot tell which database the backend is meant to reach, and treating an unknown value as external would silently ignore the operator the value was meant to select. Set postgresql.provider to external (you run the database and set backend.database.DATABASE_HOST), cnpg (CloudNativePG) or zalando (the Zalando postgres-operator)." $provider) -}}
{{- end -}}
{{- if include "monize.postgresManaged" . -}}
{{- $clusterName := $pg.clusterName | default "" | toString -}}
{{- $database := $pg.database | default "" | toString -}}
{{- $owner := $pg.owner | default "" | toString -}}
{{- $storage := $pg.storage | default dict -}}
{{- $appUser := .Values.backend.rls.DATABASE_APP_USER | default "monize_app" | toString -}}
{{- if .Values.backend.database.DATABASE_HOST -}}
{{- fail (printf "backend.database.DATABASE_HOST is %q with postgresql.provider=%s. The chart derives the host from the operator's primary Service (%s), and a second source for it would point the credentials of the operator's database at another one. Leave backend.database.DATABASE_HOST empty, or set postgresql.provider=external to use a database you run." (toString .Values.backend.database.DATABASE_HOST) $provider (include "monize.databaseHost" .)) -}}
{{- end -}}
{{- if .Values.backend.database.DATABASE_NAME -}}
{{- fail (printf "backend.database.DATABASE_NAME is %q with postgresql.provider=%s. The chart uses postgresql.database (%q) for both the database the operator creates and the one the backend connects to, and a second name would send the backend to a database the operator never made. Leave backend.database.DATABASE_NAME empty and set postgresql.database instead, or set postgresql.provider=external to use a database you run." (toString .Values.backend.database.DATABASE_NAME) $provider $database) -}}
{{- end -}}
{{- if or (not (regexMatch "^[a-z]([-a-z0-9]*[a-z0-9])?$" $clusterName)) (gt (len $clusterName) 50) -}}
{{- fail (printf "postgresql.clusterName is %q, which is not a usable name for an operator-managed cluster: it must be 1 to 50 characters of lower case letters, digits and dashes, beginning with a letter and not ending in a dash. The operators append suffixes such as -rw, -app, -ca and -repl to it to name the Services and Secrets they create, and a Kubernetes object name is limited to 63 characters, so a longer name is admitted by the API server and fails later, inside the operator. Set postgresql.clusterName to a shorter name." $clusterName) -}}
{{- end -}}
{{- $instances := $pg.instances -}}
{{- $isNumber := or (kindIs "int" $instances) (kindIs "int64" $instances) (kindIs "float64" $instances) -}}
{{- if not (and $isNumber (ge (float64 $instances) (float64 1)) (eq (floor (float64 $instances)) (float64 $instances))) -}}
{{- fail (printf "postgresql.instances is %v, but it must be a whole number of at least 1. It is how many PostgreSQL instances the operator runs (one primary plus streaming replicas); 0 is a database that is switched off and a fraction or a quoted string is not a count at all. Set postgresql.instances to 1, or to 2 or more to have a replica that can take over from the primary." (toString $instances)) -}}
{{- end -}}
{{- if not $storage.size -}}
{{- fail "postgresql.storage.size is empty. Each PostgreSQL instance needs a volume of a stated size, and without one the operator has nothing to create it from, so the cluster would never start. Set postgresql.storage.size, for example 10Gi." -}}
{{- end -}}
{{- if not (regexMatch "^[a-z_][a-z0-9_]*$" $database) -}}
{{- fail (printf "postgresql.database is %q, which is not a plain PostgreSQL identifier. The name is used unquoted in places the chart does not control (the operator's SQL, the backend's grants), so anything PostgreSQL would fold or require quoting for -- capitals, dashes, spaces -- may name a different database in one place than in another. Use lower case letters, digits and underscores, beginning with a letter or an underscore." $database) -}}
{{- end -}}
{{- if not (regexMatch "^[a-z_][a-z0-9_]*$" $owner) -}}
{{- fail (printf "postgresql.owner is %q, which is not a plain PostgreSQL identifier. It is the role the backend connects as, named unquoted in places the chart does not control, so anything PostgreSQL would fold or require quoting for -- capitals, dashes, spaces -- may name a different role in one place than in another. Use lower case letters, digits and underscores, beginning with a letter or an underscore." $owner) -}}
{{- end -}}
{{- if eq $owner "postgres" -}}
{{- fail "postgresql.owner is \"postgres\", the PostgreSQL superuser. The owner owns every table and the backend connects as it, so the application would run with the power to do anything to every database on the instance, and both operators manage the postgres account themselves. Set postgresql.owner to an ordinary application role such as monize." -}}
{{- end -}}
{{- if eq $owner $appUser -}}
{{- fail (printf "postgresql.owner is %q, the same name as backend.rls.DATABASE_APP_USER. The owner owns every table and is therefore exempt from row-level security, while the runtime role exists to be subject to it: one role cannot be both, and with RLS_MODE=enforce the policies would then apply to nobody. Rename postgresql.owner, or set backend.rls.DATABASE_APP_USER to another name (it defaults to monize_app)." $owner) -}}
{{- end -}}
{{- if eq $provider "zalando" -}}
{{- $zalando := $pg.zalando | default dict -}}
{{- $teamId := $zalando.teamId | default "" | toString -}}
{{- if not (hasPrefix (printf "%s-" $teamId) $clusterName) -}}
{{- fail (printf "postgresql.clusterName is %q, but with postgresql.provider=zalando it must begin with postgresql.zalando.teamId followed by a dash (%q). The Zalando operator rejects a manifest whose name does not carry its team prefix, so the cluster would never be created. Rename postgresql.clusterName to begin with %q, or set postgresql.zalando.teamId to the team the name already starts with." $clusterName (printf "%s-" $teamId) (printf "%s-" $teamId)) -}}
{{- end -}}
{{- /*
  namespace.create is tested by plain truthiness here because that is the test
  namespace.yaml applies: this refusal has to fire exactly when the Namespace is
  rendered, and monize.isTrue would disagree about the string "false".
*/ -}}
{{- if and .Values.namespace.create (eq (toString .Values.namespace.podSecurityEnforce) "restricted") -}}
{{- fail "postgresql.provider is zalando while namespace.create is true and namespace.podSecurityEnforce is restricted. The namespace this chart creates enforces the restricted Pod Security Standard, and the Spilo pods the Zalando operator creates cannot meet it: the operator sets no seccomp profile and drops no capabilities on them, and allows privilege escalation unless spilo_allow_privilege_escalation is turned off, all of which restricted forbids (generateContainer in the operator's pkg/cluster/k8sres.go). The StatefulSet would then create no pods at all while the backend waits for credentials that never appear. Set namespace.podSecurityEnforce=baseline, or set namespace.create=false and manage the namespace yourself, for example with a policy engine that adds those fields to the Spilo pods." -}}
{{- end -}}
{{- end -}}
{{- else -}}
{{- $appRole := $pg.appRole | default dict -}}
{{- if $appRole.passwordSecret -}}
{{- fail (printf "postgresql.appRole.passwordSecret is %q with postgresql.provider=external. It asks the chart to provision the row-level-security runtime role in an operator's database, and there is no operator here, so it would provision nothing while looking configured. Supply DATABASE_APP_PASSWORD through backend.extraEnv (a valueFrom.secretKeyRef) and create the role yourself, or set postgresql.provider to cnpg or zalando." (toString $appRole.passwordSecret)) -}}
{{- end -}}
{{- end -}}
{{- end -}}
