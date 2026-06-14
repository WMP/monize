import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@/test/render';
import { WebMcpProvider } from './WebMcpProvider';

const registerTool = vi.fn();
const initializeWebModelContext = vi.fn(() => {
  (navigator as unknown as { modelContext: unknown }).modelContext = { registerTool };
});

vi.mock('@mcp-b/global', () => ({ initializeWebModelContext }));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('@/lib/webmcp/tools', () => ({
  webMcpTools: [
    { name: 'monize_a', description: 'a', inputSchema: { type: 'object', properties: {} }, execute: vi.fn() },
    { name: 'monize_b', description: 'b', inputSchema: { type: 'object', properties: {} }, execute: vi.fn() },
  ],
}));

let mockEnabled = false;
let mockAuthed = false;
vi.mock('@/store/webMcpStore', () => ({
  useWebMcpStore: (selector: (s: { enabled: boolean }) => unknown) => selector({ enabled: mockEnabled }),
}));
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { isAuthenticated: boolean }) => unknown) =>
    selector({ isAuthenticated: mockAuthed }),
}));

describe('WebMcpProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnabled = false;
    mockAuthed = false;
    delete (navigator as unknown as { modelContext?: unknown }).modelContext;
  });

  it('registers every tool when enabled and authenticated', async () => {
    mockEnabled = true;
    mockAuthed = true;
    render(<WebMcpProvider />);
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(2));
    expect(initializeWebModelContext).toHaveBeenCalled();
  });

  it('does nothing when disabled', async () => {
    mockEnabled = false;
    mockAuthed = true;
    render(<WebMcpProvider />);
    await new Promise((r) => setTimeout(r, 0));
    expect(initializeWebModelContext).not.toHaveBeenCalled();
    expect(registerTool).not.toHaveBeenCalled();
  });

  it('does nothing when unauthenticated', async () => {
    mockEnabled = true;
    mockAuthed = false;
    render(<WebMcpProvider />);
    await new Promise((r) => setTimeout(r, 0));
    expect(registerTool).not.toHaveBeenCalled();
  });
});
