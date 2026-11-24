import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

const testOnMac = process.platform === "darwin" ? it : it.skip;

testOnMac(
  "reads local pages by UID, deduplicates them and skips a mixed-UID page",
  () => {
    const root = mkdtempSync(join(tmpdir(), "yaaglm-wish-cache-"));
    try {
      execFileSync("bash", ["scripts/stage-wish-history.sh", root]);
      const arch = process.arch === "arm64" ? "arm64" : "x64";
      const helper = join(root, "sidecar", arch, "wish-history");
      const installCache = join(root, "Client_Data", "webCaches");
      const cache = join(installCache, "2.0.0", "Cache", "Cache_Data");
      mkdirSync(cache, { recursive: true });
      const row = (uid: string, id: string) => ({
        uid,
        id,
        gacha_type: "301",
        item_id: "10000003",
        rank_type: "5",
        time: "2026-11-22 11:00:00",
        private_field: "synthetic-value",
      });
      const page = (list: ReturnType<typeof row>[]) =>
        JSON.stringify({ retcode: 0, data: { list } });
      const first = row("100000001", "15");
      const second = row("100000002", "16");
      writeFileSync(
        join(cache, "data_2"),
        page([first]) + "\0" + page([second])
      );
      writeFileSync(
        join(cache, "data_3"),
        page([second, row(first.uid, "17")])
      );
      writeFileSync(join(cache, "f_000001"), page([first]));

      const output = execFileSync(helper, {
        input: JSON.stringify({ installCache, directories: [] }),
        encoding: "utf8",
      });
      const reply = JSON.parse(output);
      expect(reply.state).toBe("ok");
      expect(
        reply.accounts.map(
          (account: { uid: string; list: { id: string }[] }) => [
            account.uid,
            account.list.map(pull => pull.id),
          ]
        )
      ).toEqual([
        [first.uid, ["15"]],
        [second.uid, ["16"]],
      ]);
      expect(output).not.toContain("synthetic-value");
      expect(
        JSON.parse(
          execFileSync(helper, {
            input: JSON.stringify({ directories: [] }),
            encoding: "utf8",
          })
        )
      ).toEqual({ state: "no-history" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  15_000
);
