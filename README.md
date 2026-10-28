# Arc Forge Releases

Release automation and evidence ledger for Arc Forge products. This repository
copies [openclaw/releases](https://github.com/openclaw/releases) (read at
`3d63d6a`). Differences from upstream, each with its reason, are listed under
[Differences from upstream](#differences-from-upstream).

The source of truth stays in each product repository:

- source code
- git tags
- GitHub releases
- npm publish workflow

This repo keeps durable release evidence separate from the product source
repositories. One ledger serves every product, as upstream records OpenClaw and
Octopool in one ledger.

## Workflows

- `.github/workflows/ci.yml` checks the repository scripts and runs the workflow
  regression tests for pull requests and pushes to `main`. It uses a read-only
  repository token and temporary fixtures; it does not publish releases or update
  the evidence ledger.
- `.github/workflows/arcforge-release-evidence.yml` records manually supplied
  release proof runs. A product release workflow can send the same fields as a
  `arcforge_release_completed` repository dispatch.
- `.github/workflows/arcforge-release-evidence-from-full-validation.yml` ingests
  a product's completed Full Release Validation run and the child runs it logs.

The scripts use only Node.js built-ins and the Python standard library; no
dependency installation or build step is needed. Run local checks with Node.js 24
and Python 3:

```bash
node --check scripts/arcforge-release-evidence.mjs
node --check scripts/arcforge-release-evidence-from-full-validation.mjs
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v
```

## Release Evidence

The evidence workflows write release summaries under `evidence/<release-id>/`.
A release id names the product, then the version or commit: `flow-2026.10.50`,
`explainer-0.1.9`. Each evidence directory contains:

- `release-evidence.md`
- `release-evidence.json`
- `index.json`
- `runs/<label>.json`

Evidence records include release ref provenance, npm package metadata, run URLs,
workflow names, refs, SHAs, pass/fail state, timing summaries, artifact names
and artifact sizes.

Evidence records do not store raw logs, provider payloads, live-channel
transcripts, signing material, credentials, environment dumps, or downloaded
release artifacts.

Both evidence workflows publish with checkout-managed ephemeral `GITHUB_TOKEN`
credentials and `contents:write`; they do not require a persistent push PAT.
Both writers run from `main`, share a per-release concurrency group, and verify
that the complete generated evidence directory is byte-identical on `origin/main`.
Unrelated concurrent commits can be rebased; changes within the same evidence
directory fail with a request to regenerate from current main. Even an unchanged
local record is checked against fresh remote state before reporting success.
Evidence commits do not trigger push-triggered Actions workflows. Regenerating an
existing release id overwrites its stored evidence.

### Manual Evidence

Manual evidence input format:

```text
<label> <owner/repo> <run-id> <blocking|advisory>
```

Example:

```text
full-release-validation arcforgelabs/flow 40623344137 blocking
release-publish arcforgelabs/flow 40623781617 blocking
npm-release arcforgelabs/flow 40624353482 blocking
```

```bash
gh workflow run arcforge-release-evidence.yml --repo arcforgelabs/releases --ref main \
  -f release_id=flow-2026.10.50 -f source_repo=arcforgelabs/flow \
  -f release_ref=v2026.10.50 -f package_spec=@arcforgelabs/flow@2026.10.50 \
  -f runs="$(cat runs.txt)"
```

Mark a run as `blocking` when a release should not proceed without it passing.
Mark a run as `advisory` when it informed the release decision but should not
fail the release by itself.

### Dispatch from a product

A product sends a repository dispatch to this repository with secret
`ARCFORGE_RELEASES_DISPATCH_TOKEN`, as upstream's Full Release Validation does
with `OPENCLAW_RELEASES_DISPATCH_TOKEN`. The
secret is a fine-grained token with Contents read and write on
`arcforgelabs/releases` only. A product without the secret skips the dispatch
with a warning and prints the manual command; the dispatch never fails a
product release.

| Event type | Workflow | `client_payload` |
| --- | --- | --- |
| `arcforge_full_release_validation_completed` | From Full Validation | `full_validation_run_id`, `release_id`, `source_repo`, optional `release_ref`, `package_spec`, `notes` |
| `arcforge_release_completed` | Release Evidence | `release_id`, `source_repo`, `runs`, optional `release_ref`, `package_spec`, `notes` |

### Full Validation Ingest

`Arc Forge Release Evidence From Full Validation` takes a completed Full
Release Validation run id from the source repository, reads that parent run's
logs, extracts child run ids from `Dispatched <workflow>.yml: <run url>` lines,
and writes the same evidence directory shape. Lanes that run inside the parent
run as reusable workflows are proved by the parent run's result.

```bash
gh workflow run arcforge-release-evidence-from-full-validation.yml \
  --repo arcforgelabs/releases \
  --ref main \
  -f full_validation_run_id=40623344137 \
  -f release_id=flow-2026.10.50 \
  -f source_repo=arcforgelabs/flow \
  -f release_ref=v2026.10.50 \
  -f package_spec=@arcforgelabs/flow@2026.10.50
```

## Storage Policy

Store only release summaries, normalized run metadata, artifact metadata, timing
summaries, package specs, and short release-manager notes here.

Do not commit:

- raw logs
- provider prompts or responses
- customer data, patient data or live-channel transcripts
- signing material or certificates
- token-bearing npm, GitHub, channel, or provider config
- downloaded release artifacts, `.zip`, `.tgz`, or image payloads
- secret-bearing environment dumps

Raw logs and bulky proof artifacts belong in GitHub Actions retention or the
public GitHub release when they are intended for users.

## Differences from upstream

| Upstream | Here | Reason |
| --- | --- | --- |
| One source repository, `openclaw/openclaw` | `--source-repo` / `source_repo`, default `arcforgelabs/flow` | Arc Forge has several products and no single source repository. |
| Package specs must be `openclaw` | Package specs must be in `@arcforgelabs/` | Arc Forge publishes under its npm scope. |
| Full validation parent must be named `Full Release Validation` | Its file must end in `full-release-validation.yml` | Products name the workflow after themselves and set a `run-name`, so the API name is the run title. |
| Child runs come from a fixed list of OpenClaw workflows | Any `Dispatched <workflow>.yml` line for the source repository | Each product has its own child workflows. |
| Release Evidence is dispatch-only by hand | It also accepts `arcforge_release_completed` | Products without a Full Release Validation parent (the marketplace) record themselves. |
| Product performance metrics in the record | Left out | Only OpenClaw produces `openclaw-performance-*` artifacts. |
| macOS validate, publish and variant workflows | Left out | Arc Forge has no macOS app. |
| CI exercises pnpm, caches and artifacts on Linux and macOS | CI checks scripts and runs tests on Linux | Those round trips prove the macOS packaging runners, which are left out. |
| npm dist-tag operations | Not yet | Waits for `arcforgelabs/releases` as an npm trusted publisher for `@arcforgelabs/flow`. Until then Flow Release Promote in `arcforgelabs/flow` owns the dist-tags. |
| Actions pinned by major tag | Pinned by commit SHA | Arc Forge supply-chain rule, as in `arcforgelabs/flow`. |
