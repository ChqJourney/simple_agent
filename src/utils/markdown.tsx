import { Components } from 'react-markdown';
import { lazy, ReactNode, Suspense } from 'react';

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
  code({ node, inline, className, children, ...props }: CodeProps) {
    const match = /language-(\w+)/.exec(className || '');
    const codeString = String(children || '').replace(/\n$/, '');

    if (!inline && match) {
      return (
        <Suspense
          fallback={(
            <pre className="bg-gray-900 dark:bg-black rounded-lg p-3 my-2 overflow-x-auto">
              <code className="text-sm font-mono text-gray-100" {...props}>
                {codeString}
              </code>
            </pre>
          )}
        >
          <LazyCodeBlock language={match[1]} code={codeString} />
        </Suspense>
      );
    }

    return (
      <code className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 text-red-600 dark:text-red-400 rounded text-sm font-mono" {...props}>
        {children}
      </code>
    );
  },
  pre({ children }) {
    return <pre className="bg-gray-900 dark:bg-black rounded-lg p-3 my-2 overflow-x-auto">{children}</pre>;
  },
  p({ children }) {
    return <p className="mb-3 last:mb-0">{children}</p>;
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

export function parseMarkdown(content: string): string {
  return content;
}
