export const markdownProseClass = [
  "[&_h1]:mt-[1.25em] [&_h1]:mb-[0.5em] [&_h1]:text-[2em] [&_h1]:leading-tight [&_h1]:font-bold",
  "[&_h2]:mt-[1.25em] [&_h2]:mb-[0.5em] [&_h2]:text-[1.5em] [&_h2]:leading-tight [&_h2]:font-bold",
  "[&_h3]:mt-[1.25em] [&_h3]:mb-[0.5em] [&_h3]:text-[1.17em] [&_h3]:leading-tight [&_h3]:font-bold",
  "[&_h1:first-child]:mt-0 [&_h2:first-child]:mt-0 [&_h3:first-child]:mt-0",
  "[&_p]:my-[0.75em] [&_ul]:my-[0.75em] [&_ol]:my-[0.75em] [&_pre]:my-[0.75em]",
  "[&_ul]:list-disc [&_ul]:pl-8 [&_ol]:list-decimal [&_ol]:pl-8",
  "[&_pre]:overflow-auto [&_pre]:rounded [&_pre]:bg-code [&_pre]:px-4 [&_pre]:py-3",
  "[&_code]:font-mono [&_code]:text-[0.9em]",
  "[&_blockquote]:my-[0.75em] [&_blockquote]:border-l-[3px] [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted",
].join(" ");

export const embedClass = [
  "[&_.embed-youtube]:relative [&_.embed-youtube]:my-4 [&_.embed-youtube]:aspect-video [&_.embed-youtube]:w-[min(100%,40rem)]",
  "[&_.embed-youtube_iframe]:size-full [&_.embed-youtube_iframe]:rounded-lg [&_.embed-youtube_iframe]:border-0",
  "[&_.embed-og-wrap]:my-4",
  "[&_.embed-og]:m-0 [&_.embed-og]:flex [&_.embed-og]:gap-3 [&_.embed-og]:rounded-[10px] [&_.embed-og]:border [&_.embed-og]:border-border [&_.embed-og]:bg-surface [&_.embed-og]:p-3 [&_.embed-og]:text-inherit [&_.embed-og]:no-underline",
  "[&_.embed-og_img]:h-20 [&_.embed-og_img]:w-[7.5rem] [&_.embed-og_img]:rounded-md [&_.embed-og_img]:object-cover",
  "[&_.embed-og-desc]:mt-1 [&_.embed-og-desc]:text-muted [&_.embed-og_small]:mt-1 [&_.embed-og_small]:text-muted",
].join(" ");

export const editorLoadingClass =
  "flex min-h-96 items-center justify-center p-4 text-muted [[data-layout=editor]_&]:h-full [[data-layout=editor]_&]:min-h-0";

export const richEditorProseClass = [
  "[&_.tiptap]:min-h-full [&_.tiptap]:outline-none",
  "[&_.tiptap]:text-[1.05rem] [&_.tiptap]:leading-[1.7]",
  "[&_.tiptap_h1]:mt-[1.5em] [&_.tiptap_h1]:mb-[0.25em] [&_.tiptap_h1]:text-[2.05rem] [&_.tiptap_h1]:leading-[1.2] [&_.tiptap_h1]:font-bold",
  "[&_.tiptap_h2]:mt-[1.35em] [&_.tiptap_h2]:mb-[0.2em] [&_.tiptap_h2]:text-[1.55rem] [&_.tiptap_h2]:leading-[1.25] [&_.tiptap_h2]:font-semibold",
  "[&_.tiptap_h3]:mt-[1.2em] [&_.tiptap_h3]:mb-[0.15em] [&_.tiptap_h3]:text-[1.25rem] [&_.tiptap_h3]:leading-[1.3] [&_.tiptap_h3]:font-semibold",
  "[&_.tiptap_h1:first-child]:mt-0 [&_.tiptap_h2:first-child]:mt-0 [&_.tiptap_h3:first-child]:mt-0",
  "[&_.tiptap_p]:my-[0.2em]",
  "[&_.tiptap_ul]:my-[0.45em] [&_.tiptap_ol]:my-[0.45em]",
  "[&_.tiptap_ul]:list-disc [&_.tiptap_ul]:pl-7 [&_.tiptap_ol]:list-decimal [&_.tiptap_ol]:pl-7",
  "[&_.tiptap_li]:my-[0.12em] [&_.tiptap_li_p]:my-0",
  "[&_.tiptap_blockquote]:my-[0.65em] [&_.tiptap_blockquote]:border-l-[3px] [&_.tiptap_blockquote]:border-border [&_.tiptap_blockquote]:pl-4 [&_.tiptap_blockquote]:text-muted",
  "[&_.tiptap_pre]:my-[0.8em] [&_.tiptap_pre]:overflow-auto [&_.tiptap_pre]:rounded-lg [&_.tiptap_pre]:bg-code [&_.tiptap_pre]:px-4 [&_.tiptap_pre]:py-3",
  "[&_.tiptap_code]:rounded [&_.tiptap_code]:bg-code [&_.tiptap_code]:px-[0.32em] [&_.tiptap_code]:py-[0.08em] [&_.tiptap_code]:font-mono [&_.tiptap_code]:text-[0.9em]",
  "[&_.tiptap_pre_code]:bg-transparent [&_.tiptap_pre_code]:p-0",
  "[&_.tiptap_hr]:my-7 [&_.tiptap_hr]:border-0 [&_.tiptap_hr]:border-t [&_.tiptap_hr]:border-border",
  "[&_.tiptap_img]:my-3 [&_.tiptap_img]:h-auto [&_.tiptap_img]:max-w-full [&_.tiptap_img]:rounded-lg",
  "[&_.tiptap_a]:underline [&_.tiptap_a]:underline-offset-2",
  "[&_.tiptap_[data-youtube-video]]:my-4 [&_.tiptap_[data-youtube-video]]:aspect-video [&_.tiptap_[data-youtube-video]]:w-[min(100%,40rem)]",
  "[&_.tiptap_[data-youtube-video]_iframe]:size-full [&_.tiptap_[data-youtube-video]_iframe]:rounded-lg [&_.tiptap_[data-youtube-video]_iframe]:border-0",
].join(" ");

export const richEditorPlaceholderClass = [
  "[&_.tiptap_.is-empty:first-child]:before:pointer-events-none [&_.tiptap_.is-empty:first-child]:before:float-left [&_.tiptap_.is-empty:first-child]:before:h-0 [&_.tiptap_.is-empty:first-child]:before:text-muted [&_.tiptap_.is-empty:first-child]:before:content-[attr(data-placeholder)]",
  "[&_.tiptap_.is-empty.has-focus]:before:pointer-events-none [&_.tiptap_.is-empty.has-focus]:before:float-left [&_.tiptap_.is-empty.has-focus]:before:h-0 [&_.tiptap_.is-empty.has-focus]:before:text-muted [&_.tiptap_.is-empty.has-focus]:before:content-[attr(data-placeholder)]",
].join(" ");
