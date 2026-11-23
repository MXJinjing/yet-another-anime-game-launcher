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
