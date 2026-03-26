import { Fragment, memo, useCallback, useEffect, useRef } from 'react';
import { Message, AssistantStatus } from '../../types';
import { MessageItem } from './MessageItem';
import { AssistantTurn } from './AssistantTurn';

const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 32;

function isNearBottom(element: HTMLDivElement): boolean {
  return (
    element.scrollHeight - (element.scrollTop + element.clientHeight)
    <= AUTO_SCROLL_BOTTOM_THRESHOLD_PX
  );
}

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
  const shouldAutoScrollRef = useRef(true);

  const handleScroll = useCallback(() => {
    if (!listRef.current) {
      return;
    }

    shouldAutoScrollRef.current = isNearBottom(listRef.current);
  }, []);

  useEffect(() => {
    if (listRef.current && shouldAutoScrollRef.current) {
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
    <div
      ref={listRef}
      data-testid="message-list-scroll"
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-5 py-6 md:px-8"
    >
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
