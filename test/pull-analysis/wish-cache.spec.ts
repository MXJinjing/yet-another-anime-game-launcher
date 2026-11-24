import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync } from "node:zlib";
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

testOnMac(
  "decodes a Brotli history response referenced by a Chromium cache entry",
  () => {
    const root = mkdtempSync(join(tmpdir(), "yaaglm-wish-block-cache-"));
    try {
      execFileSync("bash", ["scripts/stage-wish-history.sh", root]);
      const arch = process.arch === "arm64" ? "arm64" : "x64";
      const helper = join(root, "sidecar", arch, "wish-history");
      const installCache = join(root, "Client_Data", "webCaches");
      const cache = join(installCache, "2.0.0", "Cache", "Cache_Data");
      mkdirSync(cache, { recursive: true });

      const headerSize = 8192;
      const blockFile = (blockSize: number, blocks: number) => {
        const file = Buffer.alloc(headerSize + blockSize * blocks);
        file.writeUInt32LE(0xc104cac3, 0);
        file.writeUInt32LE(blockSize, 12);
        return file;
      };
      const row = {
        uid: "100000001",
        id: "15",
        gacha_type: "400",
        item_id: "10000003",
        rank_type: "5",
        time: "2026-11-22 11:00:00",
      };
      const compressed = brotliCompressSync(
        JSON.stringify({ retcode: 0, data: { list: [row] } })
      );
      const cacheKey = Buffer.from(
        "https://example.test/api/getGachaLog?sample=local-fixture"
      );
      const headers = Buffer.from("HTTP/1.1 200 OK\0content-encoding: br\0");
      const entries = blockFile(256, 1);
      entries[80] = 1;
      entries.writeUInt32LE(cacheKey.length, headerSize + 32);
      entries.writeUInt32LE(0xb0020000, headerSize + 36);
      entries.writeUInt32LE(headers.length, headerSize + 40);
      entries.writeUInt32LE(compressed.length, headerSize + 44);
      entries.writeUInt32LE(0xc0030000, headerSize + 56);
      entries.writeUInt32LE(0x80000001, headerSize + 60);
      const keys = blockFile(1024, 1);
      cacheKey.copy(keys, headerSize);
      const responseHeaders = blockFile(4096, 1);
      headers.copy(responseHeaders, headerSize);
      writeFileSync(join(cache, "data_1"), entries);
      writeFileSync(join(cache, "data_2"), keys);
      writeFileSync(join(cache, "data_3"), responseHeaders);
      writeFileSync(join(cache, "f_000001"), compressed);

      const read = () =>
        execFileSync(helper, {
          input: JSON.stringify({ installCache, directories: [] }),
          encoding: "utf8",
        });
      const output = read();
      const { uid, ...pull } = row;
      expect(JSON.parse(output)).toEqual({
        state: "ok",
        accounts: [{ uid, list: [{ ...pull, uigf_gacha_type: "301" }] }],
      });
      expect(output).not.toContain("local-fixture");

      writeFileSync(join(cache, "f_000001"), compressed.subarray(0, 8));
      expect(JSON.parse(read())).toEqual({ state: "no-history" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  15_000
);
