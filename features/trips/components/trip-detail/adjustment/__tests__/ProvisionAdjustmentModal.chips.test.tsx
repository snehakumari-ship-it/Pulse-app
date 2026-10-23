import { fireEvent, render } from "@testing-library/react-native";
import { ProvisionAdjustmentModal } from "../ProvisionAdjustmentModal";

jest.mock("react-native", () => jest.requireActual("react-native"));
jest.mock("@/components/EntityAvatar", () => ({ EntityAvatar: () => null }));
jest.mock("@expo/vector-icons/Feather", () => "Feather");
jest.mock("@/lib/supabase", () => ({ supabase: jest.fn() }));
jest.mock("../TripAdjustmentMobileWizard", () => {
  const { Pressable, Text, View } = jest.requireActual("react-native");
  return {
    TripAdjustmentMobileWizard: (p: {
      type: string;
      impact: string;
      reason: string;
      onImpactChange: (i: "plus" | "minus") => void;
    }) => (
      <View>
        <Text testID="wizard">{`${p.type}|${p.impact}|${p.reason}`}</Text>
        <Pressable testID="to-cn" onPress={() => p.onImpactChange("minus")} />
        <Pressable testID="to-dn" onPress={() => p.onImpactChange("plus")} />
      </View>
    ),
  };
});

const base = {
  visible: true,
  onClose: jest.fn(),
  onSave: jest.fn(),
  clientName: "Apollo",
  supplierName: "SIVAN E",
  sales: 6047,
  adjSales: 6047,
  cost: 5250,
  adjCost: 5250,
  revenueSideDelta: 0,
  costSideDelta: 0,
  adjustments: [],
  lineMetaLabel: () => "",
};

describe("ProvisionAdjustmentModal — quick protocol chips", () => {
  it("supplier hub lists CN and DN chips separately", () => {
    const { getByLabelText, queryByLabelText } = render(
      <ProvisionAdjustmentModal {...base} side="supplier" />,
    );
    expect(getByLabelText("Credit note: Damages / Missing")).toBeTruthy();
    expect(getByLabelText("Credit note: POD Delay Submission")).toBeTruthy();
    expect(queryByLabelText("Debit note: Damages / Missing")).toBeNull();
    expect(getByLabelText("Debit note: Fuel Escalation")).toBeTruthy();
    expect(queryByLabelText("Credit note: Fuel Escalation")).toBeNull();
  });

  it("client hub lists sale CN and DN chips", () => {
    const { getByLabelText, queryByLabelText } = render(
      <ProvisionAdjustmentModal {...base} side="client" />,
    );
    expect(getByLabelText("Credit note: Late Delivery")).toBeTruthy();
    expect(getByLabelText("Debit note: Loading Charges")).toBeTruthy();
    expect(queryByLabelText("Debit note: Late Delivery")).toBeNull();
    expect(queryByLabelText("Credit note: POD Delay Submission")).toBeNull();
  });

  it("a chip opens the wizard with its reason, lane and impact", () => {
    const { getByLabelText, getByTestId } = render(
      <ProvisionAdjustmentModal {...base} side="supplier" />,
    );
    fireEvent.press(getByLabelText("Credit note: POD Delay Submission"));
    expect(getByTestId("wizard").props.children).toBe("cost|minus|POD Delay Submission");
  });

  it("switching DN → CN clears a DN-only reason, keeps a shared one", () => {
    const { getByLabelText, getByTestId, rerender } = render(
      <ProvisionAdjustmentModal {...base} side="supplier" />,
    );
    fireEvent.press(getByLabelText("Debit note: Fuel Escalation"));
    expect(getByTestId("wizard").props.children).toBe("cost|plus|Fuel Escalation");
    fireEvent.press(getByTestId("to-cn"));
    expect(getByTestId("wizard").props.children).toBe("cost|minus|");

    rerender(<ProvisionAdjustmentModal {...base} side="client" />);
    fireEvent.press(getByLabelText("Credit note: Late Delivery"));
    fireEvent.press(getByTestId("to-dn"));
    expect(getByTestId("wizard").props.children).toBe("revenue|plus|");
  });
});
