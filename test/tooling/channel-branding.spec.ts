import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const script = fileURLToPath(
  new URL("../../scripts/check-channel-branding.mjs", import.meta.url)
);
const launcherPayload = "src/constants/yaaglm-config.b64";
const upstreamPayload = "src/clients/secret.b64";
const fixtureName = "Example Publisher";

function withRepository(
  run: (fixture: {
    write: (file: string, content: string) => void;
    commit: (message: string) => void;
    check: (title?: string, body?: string) => ReturnType<typeof spawnSync>;
  }) => void
) {
  const cwd = mkdtempSync(join(tmpdir(), "yaaglm-branding-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

  const write = (file: string, content: string) => {
    const path = join(cwd, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  };
  const commit = (message: string) => {
    git("add", ".");
    git("commit", "--quiet", "-m", message);
  };

  try {
    git("init", "--quiet");
    git("config", "user.name", "Test Author");
    git("config", "user.email", "test@example.com");
    git("config", "commit.gpgsign", "false");
    write(".gitignore", "event.json\n");
    write(
      launcherPayload,
      Buffer.from(JSON.stringify({ brandingTerms: [fixtureName] })).toString(
        "base64"
      )
    );
    write(upstreamPayload, "dXBzdHJlYW0=\n");
    write("src/example.ts", `// ${fixtureName}\n`);
    commit("Initial fixture");
    const base = git("rev-parse", "HEAD");
    run({
      write,
      commit,
      check(title = "Neutral title", body = "") {
        write("event.json", JSON.stringify({ pull_request: { title, body } }));
        return spawnSync(process.execPath, [script, base, "HEAD"], {
          cwd,
          encoding: "utf8",
          env: {
            ...process.env,
            GITHUB_EVENT_NAME: "pull_request",
            GITHUB_EVENT_PATH: join(cwd, "event.json"),
          },
        });
      },
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

it("rejects added names and PR metadata without echoing the name", () => {
  withRepository(({ write, commit, check }) => {
    write("test/example.spec.ts", `// ${fixtureName.toUpperCase()}\n`);
    commit(`Add fixture for ${fixtureName}`);
    const result = check(fixtureName, fixtureName);
    expect(result.status).toBe(1);
    const output = String(result.stderr);
    expect(output).toContain("test/example.spec.ts");
    expect(output).toContain("commit ");
    expect(output).toContain("pull request title");
    expect(output).toContain("pull request description");
    expect(output.toLowerCase()).not.toContain(fixtureName.toLowerCase());
  });
});

it("allows removing a name and leaves the separate development mirror out of the scan", () => {
  withRepository(({ write, commit, check }) => {
    write("src/example.ts", "// The Anime Company\n");
    write("sophon_server/example.py", `# ${fixtureName}\n`);
    commit("Use neutral wording");
    expect(check().status).toBe(0);
  });
});

it("allows launcher payload changes and rejects changes to the upstream payload", () => {
  withRepository(({ write, commit, check }) => {
    write(
      launcherPayload,
      Buffer.from(
        JSON.stringify({ brandingTerms: [fixtureName], channels: {} })
      ).toString("base64")
    );
    commit("Update launcher payload");
    expect(check().status).toBe(0);

    write(upstreamPayload, "dXBzdHJlYW0y\n");
    commit("Modify upstream payload");
    const result = check();
    expect(result.status).toBe(1);
    expect(String(result.stderr)).toContain("upstream payload byte-for-byte");
  });
});
