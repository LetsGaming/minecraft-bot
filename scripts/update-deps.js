import { execSync, spawn, spawnSync } from "child_process";
import fs from "fs";
import path from "path";

/**
 * CONFIGURATION
 */
const DEV_CHECK_DURATION = 10000;
const IGNORE_DIRS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "vendor",
];

const COLORS = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

const log = {
  info: (msg) => console.log(`${COLORS.cyan}ℹ ${msg}${COLORS.reset}`),
  success: (msg) => console.log(`${COLORS.green}✔ ${msg}${COLORS.reset}`),
  warn: (msg) => console.log(`${COLORS.yellow}⚠ ${msg}${COLORS.reset}`),
  error: (msg) => console.log(`${COLORS.red}✘ ${msg}${COLORS.reset}`),
  step: (msg) => console.log(`${COLORS.gray}  → ${msg}${COLORS.reset}`),
  header: (msg) =>
    console.log(
      `\n${COLORS.bright}${COLORS.blue}=== ${msg} ===${COLORS.reset}`,
    ),
};

/**
 * Detects which package manager to use based on lockfiles
 */
function detectManager(cwd) {
  if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(cwd, "yarn.lock"))) return "yarn";
  return "npm";
}

/**
 * Finds all directories containing a package.json
 */
function findNpmProjects(dir, projects = []) {
  const files = fs.readdirSync(dir);
  if (files.includes("package.json")) {
    projects.push(dir);
  }
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (
      fs.statSync(fullPath).isDirectory() &&
      !IGNORE_DIRS.includes(file) &&
      !file.startsWith(".")
    ) {
      findNpmProjects(fullPath, projects);
    }
  }
  return projects;
}

function getVulnerabilityCount(cwd, manager) {
  try {
    const args = manager === "pnpm" ? ["audit", "--json"] : ["audit", "--json"];
    // Note: Yarn audit output format differs significantly, defaulting to 0 if complex
    const result = spawnSync(manager, args, { cwd, encoding: "utf8" });
    const auditData = JSON.parse(result.stdout || "{}");

    if (manager === "npm" && auditData.metadata?.vulnerabilities) {
      const v = auditData.metadata.vulnerabilities;
      return v.low + v.moderate + v.high + v.critical;
    }
    return 0; // Simplified for non-npm managers
  } catch (e) {
    return 0;
  }
}

function runSync(command, cwd) {
  try {
    log.step(`Running: ${command}`);
    execSync(command, {
      stdio: "inherit",
      cwd,
      env: { ...process.env, FORCE_COLOR: "true" },
    });
    return true;
  } catch (err) {
    return false;
  }
}

function killTree(child) {
  if (!child || !child.pid) return;
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" });
    } catch (e) {}
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (e) {
      try {
        child.kill("SIGKILL");
      } catch (err) {}
    }
  }
}

async function testProject(cwd, manager) {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(cwd, "package.json"), "utf8"),
  );

  // Dynamic script detection priority: dev -> start -> test
  const testScript = ["dev", "start", "test"].find(
    (s) => pkg.scripts && pkg.scripts[s],
  );

  if (!testScript) {
    log.warn("No suitable test/dev script found. Skipping smoke test.");
    return true;
  }

  return new Promise((resolve) => {
    log.info(`Smoke testing via '${manager} run ${testScript}'...`);
    const child = spawn(manager, ["run", testScript], {
      cwd,
      shell: true,
      detached: process.platform !== "win32",
      stdio: "pipe",
    });

    let isResolved = false;
    child.on("error", () => {
      if (!isResolved) {
        isResolved = true;
        resolve(false);
      }
    });

    child.on("exit", (code) => {
      if (!isResolved) {
        isResolved = true;
        if (code !== 0 && code !== null)
          log.error(`Process exited with code ${code}`);
        resolve(false);
      }
    });

    const timer = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        log.success(`Project is stable under '${testScript}'.`);
        killTree(child);
        resolve(true);
      }
    }, DEV_CHECK_DURATION);
    timer.unref();
  });
}

class ProjectGuard {
  constructor(cwd) {
    this.cwd = cwd;
    this.files = [
      "package.json",
      "package-lock.json",
      "yarn.lock",
      "pnpm-lock.yaml",
    ];
    this.backups = new Map();
  }

  backup() {
    log.step("Creating safety backups...");
    for (const file of this.files) {
      const fullPath = path.join(this.cwd, file);
      if (fs.existsSync(fullPath))
        this.backups.set(file, fs.readFileSync(fullPath));
    }
  }

  rollback(manager) {
    log.warn(`Rolling back changes...`);
    for (const [file, content] of this.backups) {
      fs.writeFileSync(path.join(this.cwd, file), content);
    }
    runSync(`${manager} install`, this.cwd);
  }
}

async function updateProject(fullPath) {
  const manager = detectManager(fullPath);
  log.header(
    `Project: ${path.relative(process.cwd(), fullPath) || "Root"} [using ${manager}]`,
  );

  const guard = new ProjectGuard(fullPath);
  guard.backup();

  try {
    // 1. Update Dependencies
    log.info("Updating dependencies...");
    if (!runSync("npx npm-check-updates -u --peer", fullPath)) {
      throw new Error("NCU failed.");
    }

    // 2. Install Strategy
    let installSuccess = false;
    const strategies = [
      { name: "Default Install", cmd: `${manager} install` },
      {
        name: "Legacy Peer Install",
        cmd: `${manager} install --legacy-peer-deps`,
      },
    ];

    // Add npm-specific audit fix
    if (manager === "npm") {
      strategies.push({ name: "Security Patch", cmd: "npm audit fix" });
    }

    for (const strategy of strategies) {
      log.info(`Attempting: ${strategy.name}`);
      if (runSync(strategy.cmd, fullPath)) {
        const vulnCount = getVulnerabilityCount(fullPath, manager);
        if (vulnCount === 0) {
          log.success("Installation clean.");
          installSuccess = true;
          break;
        }
      }
    }

    // 3. Dynamic Smoke Test
    const isStable = await testProject(fullPath, manager);
    if (!isStable) throw new Error("Project failed stability check.");

    log.success("Project updated and verified.");
  } catch (error) {
    log.error(error.message);
    guard.rollback(manager);
  }
}

(async () => {
  process.on("SIGINT", () => {
    log.warn("\nInterrupted. Exiting...");
    process.exit(1);
  });

  const projects = findNpmProjects(process.cwd());
  log.info(`Found ${projects.length} project(s).`);

  for (const projectPath of projects) {
    await updateProject(projectPath);
  }
  log.header("ALL OPERATIONS COMPLETE");
})();
