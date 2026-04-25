"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders Groq's assistant replies as themed Markdown.
 *
 * Why this exists:
 *   Groq GPT-OSS-120B naturally emits **bold**, *italic*, `code`, bullet
 *   lists, and tables because that's the cleanest way to structure an
 *   answer. Rendering the reply as raw text (the original implementation)
 *   left literal asterisks on screen.
 *
 * Safety:
 *   `react-markdown` parses Markdown only and does NOT evaluate embedded
 *   HTML by default, so feeding untrusted LLM output is safe. We never
 *   pass `rehype-raw`.
 *
 * Streaming:
 *   Re-rendering on every token delta works because the parser handles
 *   unclosed spans gracefully (e.g. "**bold" before the closing `**`
 *   arrives renders as plain text until the match is found).
 */
export default function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => (
            <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-[var(--foreground)]">
              {children}
            </strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => (
            <ul className="mb-2 ml-4 list-disc space-y-1 last:mb-0 marker:text-[var(--muted)]">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-2 ml-4 list-decimal space-y-1 last:mb-0 marker:text-[var(--muted)]">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          h1: ({ children }) => (
            <h3 className="mb-1 mt-1 text-sm font-semibold">{children}</h3>
          ),
          h2: ({ children }) => (
            <h3 className="mb-1 mt-1 text-sm font-semibold">{children}</h3>
          ),
          h3: ({ children }) => (
            <h4 className="mb-1 mt-1 text-sm font-semibold">{children}</h4>
          ),
          blockquote: ({ children }) => (
            <blockquote className="mb-2 border-l-2 border-[var(--accent)]/50 pl-2 italic text-[var(--muted)]">
              {children}
            </blockquote>
          ),
          code: ({ className, children, ...props }) => {
            const isBlock = className?.includes("language-");
            if (isBlock) {
              return (
                <code
                  className="block overflow-x-auto rounded-md bg-[var(--background)] px-2 py-1.5 font-mono text-[12px] ring-1 ring-[var(--panel-border)]"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code
                className="rounded bg-[var(--background)] px-1 py-[1px] font-mono text-[12px] ring-1 ring-[var(--panel-border)]"
                {...props}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => <pre className="mb-2 last:mb-0">{children}</pre>,
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent)] underline underline-offset-2 hover:opacity-80"
            >
              {children}
            </a>
          ),
          hr: () => <hr className="my-3 border-[var(--panel-border)]" />,
          table: ({ children }) => (
            <div className="mb-2 overflow-x-auto last:mb-0">
              <table className="min-w-full border-collapse text-[12px]">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-[var(--panel-border)] bg-[var(--background)] px-2 py-1 text-left font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-[var(--panel-border)] px-2 py-1 align-top">
              {children}
            </td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
