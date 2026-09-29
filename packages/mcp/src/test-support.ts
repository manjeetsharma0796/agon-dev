import { liveIo, type ToolIo, type VaultRules } from './io.js'

// Shared by this package's own tests (token-budget.token.test.ts, third-party-client.test.ts).
// Not part of the package's public API.
//
// Typed loosely on purpose: `callAsTool` returns the SDK's `CallToolResult`, but the SDK client's
// `callTool()` widens that to a union that also covers the pre-2024-10-07 "toolResult" shape with
// no `content` field. Neither this package nor any tool it registers ever produces that shape, so
// the check is a runtime one, the same trust boundary the rest of this file's callers cross when
// they parse `text` as JSON.
export const textOf = (result: unknown): string => {
  const content = (result as { content?: unknown } | undefined)?.content
  const block = (content as Array<{ type?: unknown; text?: unknown }> | undefined)?.[0]
  if (block === undefined || block.type !== 'text' || typeof block.text !== 'string') {
    throw new Error('expected a text content block, got: ' + JSON.stringify(block))
  }
  return block.text
}

/**
 * The live io with its chain read replaced, so a test can call list_rules without a chain. Every
 * other read stays live, which keeps the replay tests exactly as they were.
 */
export const withChain = (vaultRules: VaultRules): ToolIo => ({
  ...liveIo(),
  loadVaultRules: async () => vaultRules,
})
