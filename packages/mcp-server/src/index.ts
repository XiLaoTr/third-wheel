/** MCP server bridging AI agents to the running app. */
import { PACKAGE_NAME as CORE_PACKAGE_NAME } from '@third-wheel/core';

export const PACKAGE_NAME = '@third-wheel/mcp-server';

/** Workspace packages this one depends on. */
export const DEPENDS_ON: readonly string[] = [CORE_PACKAGE_NAME];

export * from './bridge-client.js';
