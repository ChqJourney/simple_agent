import { Components } from 'react-markdown';
import { lazy, ReactNode, Suspense } from 'react';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

const LazyCodeBlock = lazy(async () => {
  const module = await import('../components/common/CodeBlock');
  return { default: module.CodeBlock };
});

interface CodeProps {
  node?: unknown;
  inline?: boolean;
  className?: string;
  children?: ReactNode;
}

export const markdownComponents: Components = {
  table({ children }) {
    return (
      <div className="my-4 overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
        <table className="min-w-full border-collapse bg-white text-sm dark:bg-gray-900">
          {children}
        </table>
      </div>
    );
  },
  thead({ children }) {
    return <thead className="bg-gray-50 dark:bg-gray-800/80">{children}</thead>;
  },
  tbody({ children }) {
    return <tbody>{children}</tbody>;
  },
  tr({ children }) {
    return <tr className="border-b border-gray-200 last:border-b-0 dark:border-gray-700">{children}</tr>;
  },
  th({ children }) {
    return (
      <th className="border-r border-gray-200 px-4 py-3 text-left font-semibold text-gray-900 last:border-r-0 dark:border-gray-700 dark:text-gray-100">
        {children}
      </th>
    );
  },
  td({ children }) {
    return (
      <td className="border-r border-gray-200 px-4 py-3 align-top text-gray-700 last:border-r-0 dark:border-gray-700 dark:text-gray-200">
        {children}
      </td>
    );
  },
  code({ node, inline, className, children, ...props }: CodeProps) {
    const match = /language-(\w+)/.exec(className || '');
    const codeString = String(children || '').replace(/\n$/, '');

    if (!inline && match) {
      return (
        <Suspense
          fallback={(
            <pre className="my-3 overflow-x-auto rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
              <code className="text-sm font-mono text-slate-800 dark:text-slate-100" {...props}>
                {codeString}
              </code>
            </pre>
          )}
        >
          <LazyCodeBlock language={match[1]} code={codeString} />
        </Suspense>
      );
    }

    if (!inline) {
      return (
        <code
          className={[
            className,
            'font-mono text-sm text-slate-800 dark:text-slate-100',
          ].filter(Boolean).join(' ')}
          {...props}
        >
          {children}
        </code>
      );
    }

    return (
      <code
        className="rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[0.92em] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre({ children }) {
    return (
      <pre className="my-3 overflow-x-auto rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
        {children}
      </pre>
    );
  },
  p({ children }) {
    return <p className="mb-3 last:mb-0 whitespace-pre-wrap">{children}</p>;
  },
  ul({ children }) {
    return <ul className="list-disc pl-6 mb-3">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="list-decimal pl-6 mb-3">{children}</ol>;
  },
  li({ children }) {
    return <li className="my-1">{children}</li>;
  },
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-500 dark:text-blue-400 hover:underline">
        {children}
      </a>
    );
  },
  blockquote({ children }) {
    return <blockquote className="border-l-4 border-gray-300 dark:border-gray-600 pl-4 italic my-2">{children}</blockquote>;
  },
};

export const markdownRemarkPlugins = [remarkGfm, remarkBreaks];

const BLOCK_START_PATTERN = /^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```)/;

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 1;
}

function decodePossiblyEscapedMarkdown(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return content;
  }

  const parseCandidates: string[] = [];
  if (trimmed.startsWith('"content"')) {
    parseCandidates.push(`{${trimmed}}`);
  }
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    parseCandidates.push(trimmed);
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    parseCandidates.push(trimmed);
  }

  for (const candidate of parseCandidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (typeof parsed === 'string') {
        return parsed;
      }
      if (
        typeof parsed === 'object'
        && parsed !== null
        && 'content' in parsed
        && typeof (parsed as { content?: unknown }).content === 'string'
      ) {
        return (parsed as { content: string }).content;
      }
    } catch {
      // Fall through to lighter heuristics.
    }
  }

  const hasEscapedNewlines = content.includes('\\n');
  const hasRealNewlines = content.includes('\n');
  if (hasEscapedNewlines && !hasRealNewlines) {
    return content
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"');
  }

  return content;
}

export function parseMarkdown(content: string): string {
  const decoded = decodePossiblyEscapedMarkdown(content).replace(/\r\n?/g, '\n');
  const sourceLines = decoded.split('\n');
  const normalizedLines: string[] = [];
  let previousSourceLine = '';

  sourceLines.forEach((line) => {
    const trimmed = line.trim();
    const currentIsTable = isTableRow(line);
    const previousIsTable = isTableRow(previousSourceLine);
    const startsBlock = BLOCK_START_PATTERN.test(trimmed) || currentIsTable;
    const previousOutputLine = normalizedLines[normalizedLines.length - 1] || '';

    if (
      trimmed
      && startsBlock
      && previousOutputLine.trim()
      && !(currentIsTable && previousIsTable)
    ) {
      normalizedLines.push('');
    }

    normalizedLines.push(line);
    previousSourceLine = line;
  });

  return normalizedLines
    .join('\n')
    .replace(
      /([^\n])\n(?!\n|#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```|\|)/g,
      '$1  \n'
    );
}
