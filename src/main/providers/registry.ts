import { FetchProvider } from './types'
import { createChatGPTProvider } from './chatgpt'
import { createClaudeProvider } from './claude'
import { createGeminiProvider } from './gemini'
import { createAntigravityProvider } from './antigravity'
import { createGrokProvider } from './grok'
import { createCopilotProvider } from './copilot'

const providers: Map<string, FetchProvider> = new Map()

function registerProvider(provider: FetchProvider): void {
  providers.set(provider.id, provider)
}

function getProvider(id: string): FetchProvider | undefined {
  return providers.get(id)
}

function getAllProviders(): FetchProvider[] {
  return Array.from(providers.values())
}

function unregisterProvider(id: string): boolean {
  return providers.delete(id)
}

function resetProviders(): void {
  providers.clear()
}

export function initializeDefaultProviders(): void {
  resetProviders()
  registerProvider(createChatGPTProvider())
  registerProvider(createClaudeProvider())
  registerProvider(createGeminiProvider())
  registerProvider(createAntigravityProvider())
  registerProvider(createGrokProvider())
  registerProvider(createCopilotProvider())
}

export { registerProvider, getProvider, getAllProviders, unregisterProvider, resetProviders }
