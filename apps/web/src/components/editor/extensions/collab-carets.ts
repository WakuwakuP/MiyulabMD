import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  clampPos,
  mdToPm,
  type OffsetMap,
} from "../../../lib/markdown-pm-map.ts";
import type { RemoteMarkdownCursor } from "../../../lib/rich-awareness.ts";

export const collabCaretsKey = new PluginKey("collabCarets");

type Options = {
  getMap: () => OffsetMap | null;
  getPeers: () => RemoteMarkdownCursor[];
};

function caretDom(color: string, name: string): HTMLElement {
  const caret = document.createElement("span");
  caret.className =
    "relative inline-block w-0 align-text-bottom text-[length:inherit] leading-[inherit] pointer-events-none -mx-px";
  caret.style.setProperty("--caret-color", color);

  const bar = document.createElement("span");
  bar.className = "block h-[1.15em] w-0.5";
  bar.style.background = color;
  bar.setAttribute("aria-hidden", "true");

  const label = document.createElement("span");
  label.className =
    "absolute bottom-[calc(100%+2px)] left-0 z-[5] whitespace-nowrap rounded-t rounded-br px-[0.3rem] py-[0.05rem] text-[11px] font-semibold leading-tight text-white";
  label.style.background = color;
  label.textContent = name;

  caret.append(bar, label);
  return caret;
}

function decorationsFor(doc: PMNode, options: Options): DecorationSet {
  const map = options.getMap();
  if (!map) return DecorationSet.empty;

  const widgets: Decoration[] = [];
  for (const peer of options.getPeers()) {
    const from = clampPos(doc, mdToPm(map, Math.min(peer.anchor, peer.head)));
    const to = clampPos(doc, mdToPm(map, Math.max(peer.anchor, peer.head)));
    const head = clampPos(doc, mdToPm(map, peer.head));
    if (from !== to) {
      widgets.push(
        Decoration.inline(from, to, {
          class: "rounded-sm",
          style: `background-color: ${peer.colorLight}`,
        }),
      );
    }
    widgets.push(
      Decoration.widget(head, () => caretDom(peer.color, peer.name), {
        side: peer.head - peer.anchor > 0 ? -1 : 1,
        key: String(peer.clientId),
      }),
    );
  }
  return DecorationSet.create(doc, widgets);
}

export const CollabCarets = Extension.create<Options>({
  name: "collabCarets",

  addOptions() {
    return {
      getMap: () => null,
      getPeers: () => [],
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin({
        key: collabCaretsKey,
        state: {
          init: (_config, state) => decorationsFor(state.doc, options),
          apply: (tr, value, _old, state) => {
            if (tr.docChanged || tr.getMeta(collabCaretsKey)) {
              return decorationsFor(state.doc, options);
            }
            return value.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});
