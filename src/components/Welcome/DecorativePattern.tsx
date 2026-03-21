import React from 'react';

export const DecorativePattern: React.FC = () => {
  return (
    <div className="fixed left-2 top-0 bottom-0 w-64 pointer-events-none overflow-hidden">
      <svg
        className="h-full w-full"
        viewBox="0 0 200 800"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M0 100L80 140V260L0 300"
          stroke="#94A3B8"
          strokeWidth="1.5"
        />
        <path
          d="M0 100L60 70V190L0 220"
          stroke="#94A3B8"
          strokeWidth="1.5"
        />
        <path
          d="M60 70L80 80"
          stroke="#94A3B8"
          strokeWidth="1.5"
        />
        <path
          d="M0 300L80 340V460L0 500"
          stroke="#94A3B8"
          strokeWidth="1.5"
        />
        <path
          d="M0 300L60 270V390L0 420"
          stroke="#94A3B8"
          strokeWidth="1.5"
        />
        <path
          d="M60 270L80 280"
          stroke="#94A3B8"
          strokeWidth="1.5"
        />
        <path
          d="M0 500L80 540V660L0 700"
          stroke="#94A3B8"
          strokeWidth="1.5"
        />
        <path
          d="M0 500L60 470V590L0 620"
          stroke="#94A3B8"
          strokeWidth="1.5"
        />
        <path
          d="M60 470L80 480"
          stroke="#94A3B8"
          strokeWidth="1.5"
        />
      </svg>
    </div>
  );
};
