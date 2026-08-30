import { common, createLowlight } from "lowlight";

export const codeBlockLowlight = createLowlight(common);

export const CODE_BLOCK_LANGUAGES = codeBlockLowlight.listLanguages().sort();
