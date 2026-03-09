import { Components } from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { ReactNode } from 'react';

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
        <SyntaxHighlighter
          style={oneDark}
          language={match[1]}
          PreTag="div"
          {...props}
        >
          {codeString}
        </SyntaxHighlighter>
      );
    }
    
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  pre({ children }) {
    return <pre className="pre-wrapper">{children}</pre>;
  },
  p({ children }) {
    return <p className="paragraph">{children}</p>;
  },
  ul({ children }) {
    return <ul className="list-disc pl-6">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="list-decimal pl-6">{children}</ol>;
  },
  li({ children }) {
    return <li className="my-1">{children}</li>;
  },
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
        {children}
      </a>
    );
  },
  blockquote({ children }) {
    return <blockquote className="border-l-4 border-gray-300 pl-4 italic">{children}</blockquote>;
  },
};

export function parseMarkdown(content: string): string {
  return content;
}