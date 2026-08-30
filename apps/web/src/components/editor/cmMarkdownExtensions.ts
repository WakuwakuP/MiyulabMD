import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  HighlightStyle,
  LanguageDescription,
  syntaxHighlighting,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { classHighlighter, tags } from "@lezer/highlight";
import { highlightLanguage, parseFenceInfo } from "@miyulabmd/markdown";

function languageForFence(info: string) {
  const name = highlightLanguage(parseFenceInfo(info));
  if (!name) return null;
  return LanguageDescription.matchLanguageName(languages, name, true);
}

const markdownHighlightExtras = HighlightStyle.define([
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
