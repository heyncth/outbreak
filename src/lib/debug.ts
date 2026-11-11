/** Always-on lifecycle logger — strip with rg before release if noisy. */
export function dbg(...args: unknown[]): void {
  const t = new Date().toISOString().slice(11, 23);
  console.info(`[dbg ${t}]`, ...args);
}
