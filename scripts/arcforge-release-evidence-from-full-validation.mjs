#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_SOURCE_REPO = "arcforgelabs/flow";

function usage() {
  console.log(`Usage:
  node scripts/arcforge-release-evidence-from-full-validation.mjs \\
    --full-validation-run-id 24977011361 \\
    --release-id flow-2026.10.50 \\
    [--source-repo arcforgelabs/flow] \\
    [--release-ref v2026.10.50] \\
    [--package-spec @arcforgelabs/flow@2026.10.50] \\
    [--notes-file /tmp/notes.md] \\
    [--output-root evidence]
`);
}

function parseArgs(argv) {
  const args = {
    fullValidationRunId: "",
    releaseId: "",
    releaseRef: "",
    packageSpec: "",
    notesFile: "",
    outputRoot: "evidence",
    sourceRepo: DEFAULT_SOURCE_REPO,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[i];
    };
    switch (arg) {
      case "--full-validation-run-id":
        args.fullValidationRunId = next();
        break;
      case "--release-id":
        args.releaseId = next();
        break;
      case "--release-ref":
        args.releaseRef = next();
        break;
      case "--package-spec":
        args.packageSpec = next();
        break;
      case "--notes-file":
        args.notesFile = next();
        break;
      case "--output-root":
        args.outputRoot = next();
        break;
      case "--source-repo":
        args.sourceRepo = next() || DEFAULT_SOURCE_REPO;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!/^[0-9]+$/.test(args.fullValidationRunId)) {
    throw new Error("--full-validation-run-id must be numeric");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(args.releaseId)) {
    throw new Error(
      "--release-id must contain only letters, numbers, dot, underscore, or dash",
    );
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(args.sourceRepo)) {
    throw new Error("--source-repo must be owner/repo");
  }
  return args;
}

async function githubJson(pathname) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "arcforge-release-evidence",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`https://api.github.com${pathname}`, { headers });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `GitHub API ${pathname} failed: ${response.status} ${response.statusText}\n${body}`,
    );
  }
  return body ? JSON.parse(body) : null;
}

async function githubText(pathname) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "arcforge-release-evidence",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`https://api.github.com${pathname}`, { headers });
  const body = await response.text();
  if (response.status === 404) {
    return "";
  }
  if (!response.ok) {
    throw new Error(
      `GitHub API ${pathname} failed: ${response.status} ${response.statusText}\n${body}`,
    );
  }
  return body;
}

async function githubPaged(pathname) {
  const values = [];
  for (let page = 1; page <= 10; page += 1) {
    const separator = pathname.includes("?") ? "&" : "?";
    const payload = await githubJson(
      `${pathname}${separator}per_page=100&page=${page}`,
    );
    const pageValues = payload?.jobs ?? payload?.workflow_runs ?? [];
    values.push(...pageValues);
    if (!Array.isArray(pageValues) || pageValues.length < 100) break;
  }
  return values;
}

// Each product's Full Release Validation logs one line per child run it starts:
//   Dispatched <workflow>.yml: https://github.com/<owner>/<repo>/actions/runs/<id>
// Upstream lists OpenClaw's own child workflows; Arc Forge products differ, so
// the label is the workflow file name. Lanes that run inside the parent run
// (reusable workflows) are already proved by the parent run's result.
function collectChildRuns(logText, sourceRepo) {
  const repo = sourceRepo.replace(/[.]/g, "\\.");
  const re = new RegExp(
    `Dispatched ([A-Za-z0-9_.-]+)\\.ya?ml:\\s+https://github\\.com/${repo}/actions/runs/([0-9]+)`,
    "g",
  );
  return [...logText.matchAll(re)].map((match) => ({
    label: match[1],
    workflow: `${match[1]}.yml`,
    runId: match[2],
  }));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCompletedFullValidationRun(owner, repo, runId) {
  const maxAttempts = 40;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const parentRun = await githubJson(`/repos/${owner}/${repo}/actions/runs/${runId}`);
    // Products name the file after themselves (flow-full-release-validation.yml)
    // and set a run-name, so the file path identifies the workflow, not the name.
    if (!/full-release-validation\.ya?ml$/.test(parentRun.path || "")) {
      throw new Error(
        `Run ${runId} is ${parentRun.path}, not a Full Release Validation workflow`,
      );
    }
    if (parentRun.status === "completed") {
      return parentRun;
    }
    console.log(
      `Full Release Validation run ${runId} is ${parentRun.status}; waiting before ingesting evidence (${attempt}/${maxAttempts})`,
    );
    await sleep(30_000);
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [owner, repo] = args.sourceRepo.split("/");
  const parentRun = await waitForCompletedFullValidationRun(
    owner,
    repo,
    args.fullValidationRunId,
  );
  if (!parentRun) {
    console.log(
      `Full Release Validation run ${args.fullValidationRunId} did not complete before the evidence wait timeout; leaving evidence for a later dispatch`,
    );
    return;
  }

  const jobs = await githubPaged(
    `/repos/${owner}/${repo}/actions/runs/${args.fullValidationRunId}/jobs`,
  );
  const childRuns = new Map();
  for (const job of jobs) {
    const logText = await githubText(`/repos/${owner}/${repo}/actions/jobs/${job.id}/logs`);
    for (const child of collectChildRuns(logText, args.sourceRepo)) {
      childRuns.set(child.label, child);
    }
  }

  const parentRole = childRuns.size > 0 ? "advisory" : "blocking";
  const runLines = [
    `full-release-validation ${args.sourceRepo} ${args.fullValidationRunId} ${parentRole}`,
  ];
  for (const child of childRuns.values()) {
    runLines.push(`${child.label} ${args.sourceRepo} ${child.runId} blocking`);
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "arcforge-release-evidence-"));
  const runsFile = path.join(tmpDir, "runs.txt");
  const notesFile = args.notesFile || path.join(tmpDir, "notes.md");
  await fs.writeFile(runsFile, `${runLines.join("\n")}\n`);
  if (!args.notesFile) {
    const childSummary =
      [...childRuns.values()]
        .map((child) => `${child.workflow}: ${child.runId}`)
        .join("; ") || "no child runs found";
    await fs.writeFile(
      notesFile,
      `Automatically ingested from Full Release Validation ${args.fullValidationRunId}. Child runs: ${childSummary}.\n`,
    );
  }

  const script = path.join("scripts", "arcforge-release-evidence.mjs");
  const commandArgs = [
    script,
    "--release-id",
    args.releaseId,
    "--source-repo",
    args.sourceRepo,
    "--release-ref",
    args.releaseRef,
    "--package-spec",
    args.packageSpec,
    "--runs-file",
    runsFile,
    "--notes-file",
    notesFile,
    "--output-root",
    args.outputRoot,
  ];
  const result = spawnSync(process.execPath, commandArgs, {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
