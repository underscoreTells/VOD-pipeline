import * as os from 'node:os';

export function getAvailableParallelism(): number {
  const parallelism = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : os.cpus().length;
  return Math.max(1, parallelism);
}

export function getDefaultCpuProxyLimit(parallelism = getAvailableParallelism()): number {
  // Keep background encodes serial on typical laptops; high-core machines can sustain two.
  return Math.max(1, Math.min(2, Math.floor(parallelism / 8)));
}

export function getCpuProxyThreadLimit(parallelism = getAvailableParallelism()): number {
  const concurrentProxies = getDefaultCpuProxyLimit(parallelism);
  // Reserve an equal CPU share for Electron, the OS, and other foreground work.
  return Math.max(1, Math.min(8, Math.floor(parallelism / (concurrentProxies + 1))));
}
