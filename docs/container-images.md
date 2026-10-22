# Container images: tags and digests

Every third-party container image this repository pulls should be named by
**digest**, not only by tag. This file is the map from the human-readable tag
to the digest that is actually pulled, so a reviewer can see what a reference
means without querying a registry.

## Why a digest

A tag such as `v1.64.0-noble` or `16-alpine` is a name. Whoever controls the
publishing account -- or a compromised registry, mirror or CI token -- can point
that name at different content at any time, and every later pull silently gets
the new content. A digest (`sha256:...`) is the hash of the image index itself:
a pull by digest either returns exactly the reviewed content or fails. It is the
same rule this repository already applies to GitHub Actions, which are pinned
to full commit SHAs (`docs/release-integrity.md`, section 5).

A reference may carry both, `name:tag@sha256:digest`. Docker then pulls by the
digest and ignores the tag; the tag stays only so a reader knows which release
the digest is.

## Pinned images

The digest is the multi-architecture **image index** digest (what
`docker pull name:tag` resolves first), not a per-platform manifest.

| Image | Tag | Digest | Used in |
| --- | --- | --- | --- |
| `mcr.microsoft.com/playwright` | `v1.64.0-noble` | `sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f` | `scripts/e2e-playwright.sh` (E2E shards in `.github/workflows/ci.yml`) |
| `mirror.gcr.io/library/postgres` | `16-alpine` | `sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229` | `.github/workflows/ci.yml` (integration-test service), `scripts/verify-schema.sh` |

Per-platform manifests of the Playwright index, for reference when comparing a
pulled image (`docker image inspect --format '{{index .RepoDigests 0}}'` shows
the platform manifest on some engines):

| Tag | Platform | Manifest digest |
| --- | --- | --- |
| `v1.64.0-noble` | `linux/amd64` | `sha256:bc72a8df40831ded821e3cbc79c318c21b44d6e51dff9fd89ace7a8249c5b462` |
| `v1.64.0-noble` | `linux/arm64` | `sha256:4109b399f6d3de22a133ab935df0d7614ed0de9195d529f0ebc6255655cdb495` |

## Reading the digest of a tag

Either command prints the index digest for a tag; run it, compare, and only
then change a reference:

```sh
docker buildx imagetools inspect mcr.microsoft.com/playwright:v1.64.0-noble   # "Digest:" line

curl -sI \
  -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json' \
  https://mcr.microsoft.com/v2/playwright/manifests/v1.64.0-noble | grep -i docker-content-digest
```

A digest copied from a pull request or a chat is not evidence; read it from the
registry yourself.

## Updating the Playwright image

The image's browsers belong to exactly one Playwright release, so the image must
move together with `@playwright/test` in `e2e/package-lock.json` (for example
when Dependabot bumps it). `scripts/e2e-playwright.sh` refuses to run when the
two disagree, naming both versions.

1. Read the new index digest for `v<version>-noble` (commands above).
2. Change `IMAGE` in `scripts/e2e-playwright.sh` -- tag and digest together.
3. Change the Playwright rows of the tables above in the same commit.

## Not yet pinned

These references still pull by tag alone. Pinning them, and a guard that keeps
this file and the references in step, is tracked separately:

- `backend/Dockerfile`, `frontend/Dockerfile`: `mirror.gcr.io/library/node:24-alpine`, `mirror.gcr.io/library/node:24-slim`
- `docker-compose.e2e.yml`: `mirror.gcr.io/library/postgres:16-alpine`, `mirror.gcr.io/library/nginx:1.29-alpine`
- `docker-compose.dev.yml`, `docker-compose.prod.yml`, `docker-compose.ha.yml`: `postgres:16-alpine`, `caddy:2-alpine`, and the project's own `ghcr.io/kenlasko/monize-*:latest`
- `helm/values.yaml`: the project's own images, by tag
