import { describe, expect, it } from 'vitest';

import {
  getCpuProxyThreadLimit,
  getDefaultCpuProxyLimit,
} from '../../src/electron/media-resource-limits.js';

describe('media resource limits', () => {
  it.each([
    { parallelism: 4, proxies: 1, threads: 2 },
    { parallelism: 8, proxies: 1, threads: 4 },
    { parallelism: 16, proxies: 2, threads: 5 },
    { parallelism: 32, proxies: 2, threads: 8 },
  ])('reserves CPU capacity at $parallelism-way parallelism', ({ parallelism, proxies, threads }) => {
    expect(getDefaultCpuProxyLimit(parallelism)).toBe(proxies);
    expect(getCpuProxyThreadLimit(parallelism)).toBe(threads);
    expect(proxies * threads).toBeLessThan(parallelism);
  });
});
