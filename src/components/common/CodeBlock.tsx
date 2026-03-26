import React, { useEffect, useState } from 'react';
import { PrismAsyncLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useUIStore } from '../../stores';

interface CodeBlockProps {
  language: string;
  code: string;
}

SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('sh', bash);
SyntaxHighlighter.registerLanguage('shell', bash);
SyntaxHighlighter.registerLanguage('javascript', javascript);
SyntaxHighlighter.registerLanguage('js', javascript);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('jsx', jsx);
SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('py', python);
SyntaxHighlighter.registerLanguage('rust', rust);
SyntaxHighlighter.registerLanguage('rs', rust);
SyntaxHighlighter.registerLanguage('tsx', tsx);
SyntaxHighlighter.registerLanguage('typescript', typescript);
SyntaxHighlighter.registerLanguage('ts', typescript);

export const CodeBlock: React.FC<CodeBlockProps> = ({ language, code }) => {
  const theme = useUIStore((state) => state.theme);
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    if (typeof window === 'undefined') {
      setResolvedTheme('light');
      return undefined;
    }

    if (typeof window.matchMedia !== 'function') {
      setResolvedTheme(theme === 'dark' ? 'dark' : 'light');
      return undefined;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      setResolvedTheme(theme === 'system' ? (mediaQuery.matches ? 'dark' : 'light') : theme);
    };

    applyTheme();

    if (theme !== 'system') {
      return undefined;
    }

    mediaQuery.addEventListener('change', applyTheme);
    return () => {
      mediaQuery.removeEventListener('change', applyTheme);
    };
  }, [theme]);

  return (
    <SyntaxHighlighter
      style={resolvedTheme === 'dark' ? oneDark : oneLight}
      language={language}
      PreTag="div"
      customStyle={{
        margin: '0.75rem 0',
        borderRadius: '1rem',
        padding: '1rem',
        overflowX: 'auto',
        border: resolvedTheme === 'dark' ? '1px solid rgb(51 65 85 / 1)' : '1px solid rgb(226 232 240 / 1)',
        background: resolvedTheme === 'dark' ? 'rgb(15 23 42 / 0.88)' : 'rgb(248 250 252)',
        boxShadow: resolvedTheme === 'dark' ? 'none' : '0 1px 2px rgba(15, 23, 42, 0.06)',
      }}
      codeTagProps={{
        style: {
          fontFamily:
            'ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace',
          fontSize: '0.9rem',
        },
      }}
    >
      {code}
    </SyntaxHighlighter>
  );
};
