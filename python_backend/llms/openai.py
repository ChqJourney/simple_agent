from typing import AsyncIterator, Dict, Any, List, Optional
from openai import AsyncOpenAI
from openai.types.chat import ChatCompletion, ChatCompletionChunk
from openai import APIError, APIConnectionError, RateLimitError, AuthenticationError
from .base import BaseLLM

__all__ = ["OpenAILLM"]


class OpenAILLM(BaseLLM):
    """OpenAI provider implementation for LLM interactions.

    This class provides async methods for streaming and non-streaming
    completions using the OpenAI API.
    """

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.client = AsyncOpenAI(
            api_key=self.api_key,
            base_url=self.base_url
        )

    async def stream(  # type: ignore[override]
        self, messages: List[Dict], tools: Optional[List[Dict]] = None
    ) -> AsyncIterator[ChatCompletionChunk]:
        """Stream chat completions from OpenAI API.

        Args:
            messages: List of message dictionaries for the conversation.
            tools: Optional list of tool schemas to make available.

        Yields:
            ChatCompletionChunk objects from the streaming response.

        Raises:
            APIError: If the API request fails.
            APIConnectionError: If connection to the API fails.
            RateLimitError: If rate limit is exceeded.
            AuthenticationError: If authentication fails.
        """
        tool_schemas = self._build_tool_schemas(tools) if tools else None

        try:
            stream = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,  # type: ignore[arg-type]
                tools=tool_schemas,  # type: ignore[arg-type]
                stream=True
            )

            async for chunk in stream:
                yield chunk
        except (APIConnectionError, RateLimitError, AuthenticationError):
            raise
        except APIError:
            raise

    async def complete(  # type: ignore[override]
        self, messages: List[Dict], tools: Optional[List[Dict]] = None
    ) -> ChatCompletion:
        """Get a complete chat completion from OpenAI API.

        Args:
            messages: List of message dictionaries for the conversation.
            tools: Optional list of tool schemas to make available.

        Returns:
            ChatCompletion object containing the full response.

        Raises:
            APIError: If the API request fails.
            APIConnectionError: If connection to the API fails.
            RateLimitError: If rate limit is exceeded.
            AuthenticationError: If authentication fails.
        """
        tool_schemas = self._build_tool_schemas(tools) if tools else None

        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,  # type: ignore[arg-type]
                tools=tool_schemas,  # type: ignore[arg-type]
                stream=False
            )

            return response
        except (APIConnectionError, RateLimitError, AuthenticationError):
            raise
        except APIError:
            raise
