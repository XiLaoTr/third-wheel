import { describe, expect, it } from 'vitest';
import { DEPENDS_ON, PACKAGE_NAME } from './index.js';

describe('@third-wheel/mcp-server', () => {
  it('exposes its package name', () => {
    expect(PACKAGE_NAME).toBe('@third-wheel/mcp-server');
  });

  it('resolves @third-wheel/core through the workspace', () => {
    expect(DEPENDS_ON).toContain('@third-wheel/core');
  });
});
