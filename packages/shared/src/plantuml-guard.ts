// PlantUML features that can reach the network are rejected up front —
// shared notes would otherwise turn viewers' browsers (and the MCP
// diagram-check worker, which may fetch outbound) into confused deputies.
// Blocked vectors: `!include`/`!import` directives (stdlib is intentionally
// unsupported, F2), `!theme … from <url>`, `%load_*` data functions, URL
// sprites, Creole `<img:url>` tags, and `skinparam` image options. Plain
// text that merely mentions a URL stays allowed.
const BLOCKED_PLANTUML = new RegExp(
  [
    /![^\S\r\n]*(?:include\w*|import)\b/.source, // !include/!import, incl. via !define macros
    /![^\S\r\n]*theme\b[^\n]*\bfrom\b/.source, // !theme … from <resource>
    /%load[_a-z]*\s*\(/.source, // %load_json / %load_xml / %loadYAML …
    /sprite\s+\$?\w+(?:[^\S\r\n]*\[[^\]\n]*\])?[^\S\r\n]*(?:<|\{[^{}]*<|(?:https?:)?\/)/
      .source, // sprite <res>, {…<svg>}, url/path
    /<img\b/.source, // creole images always reference a resource
    /\bbackgroundImage\b/.source, // skinparam image (any value form)
    /<\s*(?:https?:)?\/\//.source, // <https://…> / <//host> resource refs
    /^[^\S\r\n]*skinparam\b[^\n]*(?:https?:)?\/\//.source, // skinparam … url
    /skinparam\b[^\n{]*\{[^{}]*(?:https?:)?\/\//.source, // skinparam { … url }
    /<style\b[^>]*(?:file|src|href)\s*=/.source, // creole <style file=…>
  ].join("|"),
  "im",
);

export const PLANTUML_EXTERNAL_RESOURCE_ERROR =
  "外部リソースを取り込む PlantUML 記法には対応していません";

export function validatePlantUmlSource(source: string): void {
  if (BLOCKED_PLANTUML.test(source)) {
    throw new Error(PLANTUML_EXTERNAL_RESOURCE_ERROR);
  }
}
