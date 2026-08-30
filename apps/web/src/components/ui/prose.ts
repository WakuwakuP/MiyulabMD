export const documentColumnWidthClass = "w-[min(100%,46rem)]";

export const documentColumnClass = `${documentColumnWidthClass} px-6 py-10 pb-24`;

export const richEditorColumnClass = `${documentColumnClass} pl-14`;

export const documentViewColumnClass = `${richEditorColumnClass} mx-auto`;

export const documentScrollPadClass = "px-5 py-4";

export const documentShellClass = `flex justify-center ${documentScrollPadClass}`;

export const documentPaneScrollClass = `${documentShellClass} h-full overflow-auto`;

export const documentProseClass = [
  "text-[1.05rem] leading-[1.7]",
  "[&_h1]:mt-[1.5em] [&_h1]:mb-[0.25em] [&_h1]:text-[2.05rem] [&_h1]:leading-[1.2] [&_h1]:font-bold",
  "[&_h2]:mt-[1.35em] [&_h2]:mb-[0.2em] [&_h2]:text-[1.55rem] [&_h2]:leading-[1.25] [&_h2]:font-semibold",
  "[&_h3]:mt-[1.2em] [&_h3]:mb-[0.15em] [&_h3]:text-[1.25rem] [&_h3]:leading-[1.3] [&_h3]:font-semibold",
  "[&_h1:first-child]:mt-0 [&_h2:first-child]:mt-0 [&_h3:first-child]:mt-0",
  "[&_p]:my-[0.2em]",
  "[&_ul]:my-[0.45em] [&_ol]:my-[0.45em]",
  "[&_ul]:list-disc [&_ul]:pl-7 [&_ol]:list-decimal [&_ol]:pl-7",
  "[&_li]:my-[0.12em] [&_li_p]:my-0",
  "[&_blockquote]:my-[0.65em] [&_blockquote]:border-l-[3px] [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted",
  "[&_pre]:my-[0.8em] [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:bg-[var(--syn-code-bg)] [&_pre]:px-4 [&_pre]:py-3",
  "[&_code]:rounded [&_code]:bg-code [&_code]:px-[0.32em] [&_code]:py-[0.08em] [&_code]:font-mono [&_code]:text-[0.9em]",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_.md-code]:my-[0.8em] [&_.md-code_pre]:my-0",
  "[&_.md-code:has(.md-code-filename)_pre]:rounded-t-none [&_.md-code:has(.md-code-toolbar)_pre]:rounded-t-none",
  "[&_hr]:my-7 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-border",
  "[&_img]:my-3 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-lg",
  "[&_a]:underline [&_a]:underline-offset-2",
  "[&_.embed-youtube]:relative [&_.embed-youtube]:my-4 [&_.embed-youtube]:aspect-video [&_.embed-youtube]:w-[min(100%,40rem)]",
  "[&_.embed-youtube_iframe]:size-full [&_.embed-youtube_iframe]:rounded-lg [&_.embed-youtube_iframe]:border-0",
  "[&_[data-youtube-video]]:my-4 [&_[data-youtube-video]]:aspect-video [&_[data-youtube-video]]:w-[min(100%,40rem)]",
  "[&_[data-youtube-video]_iframe]:size-full [&_[data-youtube-video]_iframe]:rounded-lg [&_[data-youtube-video]_iframe]:border-0",
  "[&_.tableWrapper]:my-[0.75em] [&_.tableWrapper]:w-full [&_.tableWrapper]:overflow-x-auto",
  "[&_table]:my-[0.75em] [&_table]:w-full [&_table]:border-collapse",
  "[&_.tableWrapper_table]:my-0",
  "[&_th]:border [&_th]:border-border [&_th]:bg-surface [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold",
  "[&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2",
  "[&_th_p]:my-0 [&_td_p]:my-0",
  "[&_.embed-og-wrap]:my-4",
  "[&_.embed-og]:m-0 [&_.embed-og]:flex [&_.embed-og]:w-full [&_.embed-og]:items-start [&_.embed-og]:gap-3 [&_.embed-og]:overflow-hidden [&_.embed-og]:rounded-[10px] [&_.embed-og]:border [&_.embed-og]:border-border [&_.embed-og]:bg-surface [&_.embed-og]:p-3 [&_.embed-og]:text-left [&_.embed-og]:text-inherit [&_.embed-og]:no-underline",
  "[&_.embed-og_img]:m-0 [&_.embed-og_img]:size-[7.5rem] [&_.embed-og_img]:shrink-0 [&_.embed-og_img]:rounded-lg [&_.embed-og_img]:object-cover",
  "[&_.embed-og-body]:flex [&_.embed-og-body]:min-h-0 [&_.embed-og-body]:min-w-0 [&_.embed-og-body]:max-h-[7.5rem] [&_.embed-og-body]:flex-1 [&_.embed-og-body]:flex-col [&_.embed-og-body]:overflow-hidden",
  "[&_.embed-og_strong]:line-clamp-2 [&_.embed-og_strong]:leading-snug",
  "[&_.embed-og-desc]:m-0 [&_.embed-og-desc]:line-clamp-2 [&_.embed-og-desc]:text-[0.85rem] [&_.embed-og-desc]:leading-snug [&_.embed-og-desc]:text-muted",
  "[&_.embed-og_small]:mt-1 [&_.embed-og_small]:block [&_.embed-og_small]:truncate [&_.embed-og_small]:text-muted",
].join(" ");

export const markdownProseClass = documentProseClass;

export const editorLoadingClass =
  "flex min-h-96 items-center justify-center p-4 text-muted [[data-layout=editor]_&]:h-full [[data-layout=editor]_&]:min-h-0";

export const richEditorProseClass =
  "[&_.tiptap]:min-h-full [&_.tiptap]:outline-none";

export const richEditorTiptapClass = [
  "tiptap",
  documentProseClass,
  richEditorColumnClass,
].join(" ");

export const richEditorPlaceholderClass = [
  "[&_.tiptap_.is-empty:first-child]:before:pointer-events-none [&_.tiptap_.is-empty:first-child]:before:float-left [&_.tiptap_.is-empty:first-child]:before:h-0 [&_.tiptap_.is-empty:first-child]:before:text-muted [&_.tiptap_.is-empty:first-child]:before:content-[attr(data-placeholder)]",
  "[&_.tiptap_.is-empty.has-focus]:before:pointer-events-none [&_.tiptap_.is-empty.has-focus]:before:float-left [&_.tiptap_.is-empty.has-focus]:before:h-0 [&_.tiptap_.is-empty.has-focus]:before:text-muted [&_.tiptap_.is-empty.has-focus]:before:content-[attr(data-placeholder)]",
].join(" ");
