type ResettableMock = {
  mockClear?: () => unknown;
  mockReset?: () => unknown;
};

export function resetMocks(...mocks: ResettableMock[]): void {
  for (const mock of mocks) {
    if (typeof mock.mockReset === "function") {
      mock.mockReset();
      continue;
    }

    if (typeof mock.mockClear === "function") {
      mock.mockClear();
    }
  }
}
