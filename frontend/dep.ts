export * as base from "../base/frontend/mod.ts"
export { preact, Signal, signals, type JSX } from "../base/frontend/mod.ts";


// @deno-types="https://raw.githubusercontent.com/alexander-g/carrot-ml/refs/tags/v2025-12-10/carrot-wasm-postprocessing.d.ts"
export { 
    initialize as wasm_postprocessing_initialize,
    CARROT_Postprocessing,
    type TreeringPostprocessingResult,
    type CellsPostprocessingResult,
    type CombinedPostprocessingResult,
    type PairedPaths,
} from "https://raw.githubusercontent.com/alexander-g/carrot-ml/refs/tags/v2025-12-10/carrot-wasm-postprocessing.js"

