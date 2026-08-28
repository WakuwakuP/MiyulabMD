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
