/**
 * Hugging Face Inference API · public surface.
 *
 * Inference is disabled unless a caller explicitly opts in and deployment
 * enables it. Credentials alone do not enable a public rendering cost path.
 * Translation is unavailable until an approved production model is selected.
 */

export { hfInference } from './client';
export type {
  HfInferenceInput,
  HfInferenceResult,
  HfCallOptions,
} from './client';

export { generateImage } from './text2image';
export type {
  GenerateImageInput,
  GenerateImageResult,
  T2IAspect,
  T2IStyle,
  T2IModelId,
} from './text2image';

export { scoreSentiment, scoreSentimentBatch } from './sentiment';
export type { SentimentResult, SentimentLabel } from './sentiment';

export { summarize } from './summarize';

export { translate, translateBatchToEnglish } from './translate';
export type { SupportedLang, TranslateInput } from './translate';
