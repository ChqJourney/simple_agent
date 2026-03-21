import { Fragment, memo, useRef, useEffect } from 'react';
import { Message, AssistantStatus } from '../../types';
import { MessageItem } from './MessageItem';
import { AssistantTurn } from './AssistantTurn';

interface MessageListProps {
  messages: Message[];
  currentStreamingContent?: string;
  currentReasoningContent?: string;
  isStreaming?: boolean;
  assistantStatus?: AssistantStatus;
  currentToolName?: string;
}

export const MessageList = memo<MessageListProps>(({
  messages,
  currentStreamingContent = '',
  currentReasoningContent = '',
  isStreaming = false,
  assistantStatus,
  currentToolName,
}) => {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, currentStreamingContent, currentReasoningContent]);

  const groups: Array<{ user?: Message; assistantMessages: Message[] }> = [];
  let currentGroup: { user?: Message; assistantMessages: Message[] } | null = null;

  messages.forEach((message) => {
    if (message.role === 'user') {
      if (currentGroup) {
        groups.push(currentGroup);
      }
      currentGroup = { user: message, assistantMessages: [] };
      return;
    }

    if (!currentGroup) {
      currentGroup = { assistantMessages: [] };
    }
    currentGroup.assistantMessages.push(message);
  });

  if (currentGroup) {
    groups.push(currentGroup);
  }

  return (
    <div ref={listRef} className="flex-1 overflow-y-auto px-5 py-6 md:px-6">
      {messages.length === 0 && !isStreaming && (
        <div className="text-center text-gray-500 dark:text-gray-400 py-8">
          <p>Just input what you want</p>
        </div>
      )}

      <div className="space-y-5">
        {groups.map((group, index) => {
          const isLastGroup = index === groups.length - 1;
          const isActiveTurn = isLastGroup && (isStreaming || assistantStatus === 'completed');

          return (
            <Fragment key={group.user?.id || `assistant-turn-${index}`}>
              {group.user && <MessageItem message={group.user} />}
              {(group.assistantMessages.length > 0 || (isStreaming && isLastGroup)) && (
                <AssistantTurn
                  messages={group.assistantMessages}
                  isStreaming={isStreaming && isLastGroup}
                  streamingContent={isActiveTurn ? currentStreamingContent : ''}
                  currentReasoningContent={isActiveTurn ? currentReasoningContent : ''}
                  assistantStatus={isActiveTurn ? assistantStatus : undefined}
                  currentToolName={isActiveTurn ? currentToolName : undefined}
                />
              )}
            </Fragment>
          );
        })}

        {groups.length === 0 && isStreaming && (
          <AssistantTurn
            messages={[]}
            isStreaming={true}
            streamingContent={currentStreamingContent}
            currentReasoningContent={currentReasoningContent}
            assistantStatus={assistantStatus}
            currentToolName={currentToolName}
          />
        )}
      </div>
    </div>
  );
});

MessageList.displayName = 'MessageList';
