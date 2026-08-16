import AponiaIcon from "./assets/Aponia.cr.webp";
import NahidaIcon from "./assets/Nahida.cr.png";
import SilverWolfIcon from "./assets/SilverWolf.cr.png";

/**
 * Loading-screen icon for a build channel. Mirrors the per-channel
 * UPDATE_UI_IMAGE exported by src/clients/*; keep the two in sync.
 */
export function getChannelBootIcon(channel: string): string {
  if (channel === "hkrpgcn" || channel === "hkrpgos") {
    return SilverWolfIcon;
  }
  if (channel === "bh3glb") {
    return AponiaIcon;
  }
  return NahidaIcon;
}
