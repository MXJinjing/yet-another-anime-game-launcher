export const miyousheGames = ["hk4e", "hkrpg", "nap"] as const;
export type MiyousheGame = (typeof miyousheGames)[number];

const gameByClient: Partial<Record<string, MiyousheGame>> = {
  hk4ecn: "hk4e",
  hkrpgcn: "hkrpg",
  napcn: "nap",
};

export function miyousheGameForChannel(channel: string, clientId: string) {
  return channel === "mhycn" || channel === clientId
    ? gameByClient[clientId]
    : undefined;
}

export const miyousheCheckInUrl = {
  hk4e: "https://act.mihoyo.com/bbs/event/signin/hk4e/index.html?bbs_auth_required=true&act_id=e202311201442471",
  hkrpg:
    "https://act.mihoyo.com/bbs/event/signin/hkrpg/index.html?act_id=e202304121516551",
  nap: "https://act.mihoyo.com/bbs/event/signin/zzz/e202406242138391.html?bbs_auth_required=true&act_id=e202406242138391",
} satisfies Record<MiyousheGame, string>;
