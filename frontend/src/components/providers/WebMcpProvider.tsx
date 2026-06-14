'use client';

import { useEffect } from 'react';
import { useWebMcpStore } from '@/store/webMcpStore';
import { useAuthStore } from '@/store/authStore';
import { webMcpTools } from '@/lib/webmcp/tools';
import { createLogger } from '@/lib/logger';

const logger = createLogger('WebMCP');

/**
 * Registers Monize's tools on the W3C `navigator.modelContext` API (polyfilled
 * by `@mcp-b/global`) so an AI agent running in the browser tab can discover and
 * call them -- using the user's existing session, with no backend exposed
 * externally. Strictly opt-in (Settings -> Preferences, default off) and only
 * while authenticated; tools are torn down via AbortSignal when either flips.
 */
export function WebMcpProvider() {
  const enabled = useWebMcpStore((s) => s.enabled);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (!enabled || !isAuthenticated || typeof window === 'undefined') {
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        const { initializeWebModelContext } = await import('@mcp-b/global');
        if (cancelled) return;
        // Idempotent; sets up navigator.modelContext if not already present.
        initializeWebModelContext({ nativeModelContextBehavior: 'preserve' });

        const modelContext = (
          navigator as unknown as {
            modelContext?: {
              registerTool: (tool: unknown, options?: { signal?: AbortSignal }) => void;
            };
          }
        ).modelContext;

        if (!modelContext?.registerTool) {
          logger.warn('navigator.modelContext unavailable after init');
          return;
        }

        let registered = 0;
        for (const tool of webMcpTools) {
          try {
            modelContext.registerTool(
              {
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
                execute: tool.execute,
              },
              { signal: controller.signal },
            );
            registered += 1;
          } catch (error) {
            logger.warn(`Failed to register WebMCP tool ${tool.name}`, error);
          }
        }
        logger.info(`Registered ${registered}/${webMcpTools.length} WebMCP tools`);
      } catch (error) {
        logger.error('WebMCP initialization failed', error);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled, isAuthenticated]);

  return null;
}
