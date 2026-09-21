// @plantuml/core ships no type declarations. The side-effect modules
// (viz-global/themes/emoji/openiconic) only register globals.
declare module "@plantuml/core" {
  export function renderToString(
    lines: string[],
    onOk: (svg: string) => void,
    onError: (error: unknown) => void,
    options?: { dark?: boolean },
  ): void;
}
declare module "@plantuml/core/viz-global.js" {}
declare module "@plantuml/core/themes.js" {}
declare module "@plantuml/core/emoji.js" {}
declare module "@plantuml/core/openiconic.js" {}
