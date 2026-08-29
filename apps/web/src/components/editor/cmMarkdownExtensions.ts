import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { classHighlighter, tags } from "@lezer/highlight";

const markdownHighlightExtras = HighlightStyle.define([
  { tag: tags.monospace, class: "tok-monospace" },
  { tag: tags.strikethrough, class: "tok-strikethrough" },
  { tag: tags.contentSeparator, class: "tok-contentSeparator" },
]);

export const markdownEditorLanguage = markdown({
  base: markdownLanguage,
  codeLanguages: languages,
});

export const markdownEditorHighlight = [
  syntaxHighlighting(classHighlighter),
  syntaxHighlighting(markdownHighlightExtras),
];
