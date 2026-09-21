// @plantuml/core ships no type declarations. The {dark} option on
// renderToString is undocumented but wired in the compiled engine; the
// diagram-rendering browser spec guards it across version bumps.
declare module "@plantuml/core" {
  export function render(
    lines: string[],
    targetId: string,
    options?: { dark?: boolean },
  ): void;
  export function renderToString(
    lines: string[],
    onSuccess: (svg: string) => void,
    onError: (message: string) => void,
    options?: { dark?: boolean },
  ): void;
}
