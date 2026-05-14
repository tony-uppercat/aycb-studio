import type { GenerateImageResult, UsageInfo } from '../types'

export interface ImageGenerationOptions {
  aspectRatio?: string
  imageSize?: string
  useGrounding?: boolean
  /** When undefined or true, the provider passes thinkingConfig HIGH (Gemini only). */
  thinking?: boolean
}

export interface ImageProvider {
  id: string
  generateImage(prompt: string, modelId: string, apiKey: string, refs?: File[], options?: ImageGenerationOptions): Promise<GenerateImageResult>
}

export interface LLMProvider {
  id: string
  chat(prompt: string, modelId: string, apiKey: string, mediaFiles?: File[]): Promise<{ text: string; status: string; usage?: UsageInfo }>
}

const imageProviders = new Map<string, ImageProvider>()
const llmProviders = new Map<string, LLMProvider>()

export function registerImageProvider(p: ImageProvider) { imageProviders.set(p.id, p) }
export function registerLLMProvider(p: LLMProvider) { llmProviders.set(p.id, p) }
export function getImageProvider(id: string): ImageProvider | undefined { return imageProviders.get(id) }
export function getLLMProvider(id: string): LLMProvider | undefined { return llmProviders.get(id) }
