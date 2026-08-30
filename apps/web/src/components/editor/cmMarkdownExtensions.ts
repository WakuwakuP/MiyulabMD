import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  HighlightStyle,
  LanguageDescription,
  syntaxHighlighting,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { classHighlighter, tags } from "@lezer/highlight";
import { inferLanguageFromFilename, parseFenceInfo } from "@miyulabmd/markdown";

function languageForFence(info: string) {
  const parsed = parseFenceInfo(info);
  for (const name of [
    parsed.language,
    inferLanguageFromFilename(parsed.filename),
  ]) {
    if (!name) continue;
    const match = LanguageDescription.matchLanguageName(languages, name, true);
    if (match) return match;
  }
  return null;
}

const markdownHighlightExtras = HighlightStyle.define([
  { tag: tags.function(tags.variableName), class: "tok-function" },
  { tag: tags.function(tags.propertyName), class: "tok-function" },
  { tag: tags.monospace, class: "tok-monospace" },
  { tag: tags.strikethrough, class: "tok-strikethrough" },
  { tag: tags.contentSeparator, class: "tok-contentSeparator" },
]);

export const markdownEditorLanguage = markdown({
  base: markdownLanguage,
  codeLanguages: languageForFence,
});

export const markdownEditorHighlight = [
  syntaxHighlighting(classHighlighter),
  syntaxHighlighting(markdownHighlightExtras),
];
