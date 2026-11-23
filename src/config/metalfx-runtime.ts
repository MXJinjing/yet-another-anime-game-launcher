/**
 * MetalFX on clients whose implementation is DXMT's swapchain upscale only
 * applies while the selected Wine uses DXMT. An unknown backend keeps the
 * control enabled, so a launcher that cannot resolve the runtime never locks
 * the user out of a setting that may still work.
 */
export function isMetalFxRuntimeUnavailable(
  dxmtOnly: boolean,
  renderBackend: string | undefined
) {
  return dxmtOnly && renderBackend !== undefined && renderBackend !== "dxmt";
}
