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

export function pullPoolTabs(game: PullGame, observed: readonly string[]) {
  return game === "hk4e"
    ? [...new Set(["301", "302", "200", "100", "500", ...observed])]
    : observed;
}
