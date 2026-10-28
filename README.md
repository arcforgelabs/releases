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
repositories. One ledger serves every side product, as upstream records Octopool.

Upstream OpenClaw core stopped writing ledger records after `2026.7.2-beta.4`
(July 2026). Its proof now stays in the product repository: the Full Release
Validation summary, its Actions artifacts and the dependency evidence asset on
the GitHub release. Its ledger dispatch is opt-in and off by default. Flow
follows that direction: it keeps its proof on its own GitHub release
(`postpublish-evidence.json`) and does not write here. Side products without a
validation pipeline of their own, such as the plugin marketplace, record here.

## Workflows

- `.github/workflows/ci.yml` checks the repository scripts and runs the workflow
  regression tests for pull requests and pushes to `main`. It uses a read-only
  repository token and temporary fixtures; it does not publish releases or update
  the evidence ledger.
- `.github/workflows/arcforge-release-evidence.yml` records manually supplied
  release proof runs. A product release workflow can send the same fields as a
  `arcforge_release_completed` repository dispatch.

The scripts use only Node.js built-ins and the Python standard library; no
dependency installation or build step is needed. Run local checks with Node.js 24
and Python 3:

```bash
node --check scripts/arcforge-release-evidence.mjs
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v
```

## Release Evidence

The evidence workflow writes release summaries under `evidence/<release-id>/`.
A release id names the product, then the version or commit: `explainer-0.1.10`. Each evidence directory contains:

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

The evidence workflow publishes with checkout-managed ephemeral `GITHUB_TOKEN`
credentials and `contents:write`; it does not require a persistent push PAT.
The writer runs from `main`, uses a per-release concurrency group, and verify
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
marketplace-release arcforgelabs/tools <run-id> blocking
marketplace-sync arcforgelabs/marketplace <run-id> advisory
```

```bash
gh workflow run arcforge-release-evidence.yml --repo arcforgelabs/releases --ref main \
  -f release_id=explainer-0.1.10 -f source_repo=arcforgelabs/marketplace \
  -f runs="$(cat runs.txt)"
```

Mark a run as `blocking` when a release should not proceed without it passing.
Mark a run as `advisory` when it informed the release decision but should not
fail the release by itself.

### Dispatch from a product

A product sends a repository dispatch to this repository with secret
`ARCFORGE_RELEASES_DISPATCH_TOKEN`, as upstream does with
`OPENCLAW_RELEASES_DISPATCH_TOKEN`. The
secret is a fine-grained token with Contents read and write on
`arcforgelabs/releases` only. A product without the secret skips the dispatch
with a warning and prints the manual command; the dispatch never fails a
product release.

| Event type | Workflow | `client_payload` |
| --- | --- | --- |
| `arcforge_release_completed` | Release Evidence | `release_id`, `source_repo`, `runs`, optional `release_ref`, `package_spec`, `notes` |

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
| One source repository, `openclaw/openclaw` | `--source-repo` / `source_repo`, required | Arc Forge has several products and no single source repository. |
| Package specs must be `openclaw` | Package specs must be in `@arcforgelabs/` | Arc Forge publishes under its npm scope. |
| Evidence From Full Validation workflow | Left out | Upstream core no longer writes the ledger by default; Flow keeps its proof on its own GitHub release, the same way. |
| Release Evidence is dispatch-only by hand | It also accepts `arcforge_release_completed` | The marketplace release records itself, as Octopool's records arrive without a person. |
| Product performance metrics in the record | Left out | Only OpenClaw produces `openclaw-performance-*` artifacts. |
| macOS validate, publish and variant workflows | Left out | Arc Forge has no macOS app. |
| CI exercises pnpm, caches and artifacts on Linux and macOS | CI checks scripts and runs tests on Linux | Those round trips prove the macOS packaging runners, which are left out. |
| npm dist-tag operations | Not yet | Waits for `arcforgelabs/releases` as an npm trusted publisher for `@arcforgelabs/flow`. Until then Flow Release Promote in `arcforgelabs/flow` owns the dist-tags. |
| Actions pinned by major tag | Pinned by commit SHA | Arc Forge supply-chain rule, as in `arcforgelabs/flow`. |
