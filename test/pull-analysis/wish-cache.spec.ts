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

testOnMac(
  "follows the last record ID and keeps validated pages when the service stops the read",
  () => {
    const root = mkdtempSync(join(tmpdir(), "yaaglm-wish-pagination-"));
    try {
      const fixture = join(root, "PaginationFixture.swift");
      const binary = join(root, "pagination-test");
      writeFileSync(
        fixture,
        `
import Foundation

let wishHistoryPageHost = "game.example.test"
let wishHistoryAPI = "https://service.example.test/gacha_info/api/getGachaLog"

@main
struct PaginationFixture {
    static func row(_ id: Int) -> Fields {
        ["uid": "100000001", "id": String(id), "gacha_type": "301",
         "time": "2026-11-22 11:00:00", "rank_type": "3"]
    }

    static func main() async {
        let head = "https://game.example.test/hk4e/event/e20190909gacha-aa11/index.html"
        let query = "?auth_appid=webview_gacha&authkey=fixture%2Bkey&game_biz=hk4e_cn&region=&extra=ignored"
        let selected = wishHistoryQuery(from: head + query, host: wishHistoryPageHost)
        precondition(selected?.first(where: { $0.name == "authkey" })?.value == "fixture+key")
        precondition(selected?.contains(where: { $0.name == "extra" }) == false)
        precondition(wishHistoryQuery(from: head + ".example" + query, host: wishHistoryPageHost) == nil)

        var calls: [String] = []
        var progress: [String] = []
        var pauses = 0
        let partial = await paginateWishHistory(request: { pool, page, cursor in
            calls.append("\\(pool):\\(page):\\(cursor)")
            switch (pool, page) {
            case ("301", 1): return (81...100).reversed().map(row)
            case ("301", 2): return [row(80)]
            default: throw WishSyncStatus.rateLimited
            }
        }, wait: { pauses += 1 }, onProgress: { pool, pages, records in
            progress.append("\\(pool):\\(pages):\\(records)")
        })
        precondition(calls == ["301:1:0", "301:2:81", "302:1:0"] && pauses == 2)
        precondition(progress == ["301:0:0", "301:1:20", "301:2:21", "302:0:21"])
        precondition(partial.status == .rateLimited)
        precondition(partial.history.byUID["100000001"]?.count == 21)

        let repeated = await paginateWishHistory(request: { _, _, _ in
            (81...100).reversed().map(row)
        }, wait: {})
        precondition(repeated.status == .incomplete)
        precondition(repeated.history.byUID["100000001"]?.count == 20)
    }
}
`
      );
      execFileSync("swiftc", [
        "-D",
        "WISH_HISTORY_TEST",
        "-parse-as-library",
        "native/wish-history.swift",
        "native/wish-history-online.swift",
        fixture,
        "-o",
        binary,
      ]);
      execFileSync(binary);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  15_000
);
