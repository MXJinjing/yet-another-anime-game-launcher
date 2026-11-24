export const pullGames = ["hk4e", "hkrpg", "nap"] as const;
export type PullGame = (typeof pullGames)[number];

const gameByClient: Partial<Record<string, PullGame>> = {
  hk4ecn: "hk4e",
  hkrpgcn: "hkrpg",
  napcn: "nap",
};

export function pullAnalysisGameForChannel(channel: string, clientId: string) {
  return channel === "mhycn" || channel === clientId
    ? gameByClient[clientId]
    : undefined;
}
