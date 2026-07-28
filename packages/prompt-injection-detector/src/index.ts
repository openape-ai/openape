export { decide, type DecisionResult } from './detector.js'
export { classifyHeuristic, createHeuristicDetector } from './heuristic.js'
export {
  DEFAULT_OWNER_THRESHOLD,
  DEFAULT_THRESHOLD,
  type Detector,
  type DetectionInput,
  type DetectionResult,
  type DetectorOptions,
  type SenderContext,
} from './types.js'
export {
  createAuditStore,
  type AuditStore,
  type AuditEntry,
} from './audit.js'
export { readInjectionConfig, type InjectionConfig } from './config.js'
export { createLLMDetector, createDetector } from './llm.js'
