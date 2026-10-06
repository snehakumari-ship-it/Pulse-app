import IndentDetailRoute from "@/app/indent/[id]";
import { INDENT_DETAIL_ANONYMOUS_CONTEXT, ROUTES } from "@/lib/routes";
import { act, render } from "@testing-library/react-native";

jest.mock("react-native", () => jest.requireActual("react-native"));
// Jest here can't run the route's dynamic import(); resolve the lazy screen synchronously.
jest.mock("react", () => {
  const React = jest.requireActual("react");
  return {
    ...React,
    lazy: () => (props: object) =>
      React.createElement(
        jest.requireMock("@/features/indents/components/IndentDetailScreen").IndentDetailScreen,
        props,
      ),
  };
});

let mockParams: Record<string, string | undefined> = {};
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock("@/lib/useSafeBack", () => ({ useSafeBack: () => jest.fn() }));
jest.mock("@/components/LazySuspenseFallback", () => ({
  LazySuspenseInlineFallback: () => null,
}));
const mockDetailProps: Array<{ indentId: string; anonymous?: boolean }> = [];
jest.mock("@/features/indents/components/IndentDetailScreen", () => ({
  IndentDetailScreen: (props: { indentId: string; anonymous?: boolean }) => {
    mockDetailProps.push(props);
    return null;
  },
}));

async function renderRoute(params: Record<string, string | undefined>) {
  mockParams = params;
  render(<IndentDetailRoute />);
  await act(async () => {});
  return mockDetailProps[mockDetailProps.length - 1];
}

beforeEach(() => {
  mockDetailProps.length = 0;
});

describe("/indent/[id] anonymous pool context", () => {
  it("the pool route helper carries the explicit anonymous context", () => {
    expect(ROUTES.indentDetailAnonymous("ind 1")).toBe(
      `/indent/ind%201?context=${INDENT_DETAIL_ANONYMOUS_CONTEXT}`,
    );
    expect(ROUTES.indentDetail("ind-1")).toBe("/indent/ind-1");
  });

  it("opens the detail anonymously only for the Network pool context", async () => {
    expect(await renderRoute({ id: "ind-1", context: "network-pool" })).toMatchObject({
      indentId: "ind-1",
      anonymous: true,
    });
  });

  it("keeps identity for a plain or unknown context", async () => {
    expect((await renderRoute({ id: "ind-1" }))?.anonymous).toBe(false);
    expect((await renderRoute({ id: "ind-1", context: "my-bids" }))?.anonymous).toBe(false);
  });
});
