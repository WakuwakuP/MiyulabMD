const BLOCK_PREFIX = /^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|`{3,})/;

export function escapeMarkdownBlockPrefix(text: string): string {
  if (!BLOCK_PREFIX.test(text)) return text;
  return text
    .replace(/^(#{1,6})(\s)/, (_all, hashes: string, space: string) => `${hashes.replace(/#/g, "\\#")}${space}`)
    .replace(/^([-*+])(\s)/, "\\$1$2")
    .replace(/^(\d+)(\.)(\s)/, "$1\\.$3")
    .replace(/^(>)/, "\\$1")
    .replace(/^(`{3,})/, (ticks) => ticks.replace(/`/g, "\\`"));
}
