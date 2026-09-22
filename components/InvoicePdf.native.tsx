import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { InvoicePdfData } from '@/components/InvoicePdf.types';
import Theme from '@/constants/Theme';
import Layout from '@/constants/Layout';

interface InvoicePdfNativeProps {
  invoiceData: InvoicePdfData;
  initialShowSplit?: boolean;
  onBack?: () => void;
}

function Meta({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
      <Text style={{ width: 120, fontSize: 12, fontWeight: '600', color: Theme.analyticsHeroBg }}>
        {label}
      </Text>
      <Text style={{ flex: 1, fontSize: 12, fontWeight: '600', color: Theme.textPrimaryDark }}>
        : {value}
      </Text>
    </View>
  );
}

export default function InvoicePdfNative({
  invoiceData,
  onBack,
}: InvoicePdfNativeProps) {
  const shipment = invoiceData.shipment;
  return (
    <View style={{ flex: 1, backgroundColor: Theme.analyticsCanvas }}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          style={{
            minHeight: Layout.minTouchTargetSize,
            justifyContent: 'center',
            paddingHorizontal: Layout.screenPaddingHorizontal,
            backgroundColor: Theme.screenBackground,
            borderBottomWidth: 1,
            borderBottomColor: Theme.borderMedium,
          }}
          accessibilityRole="button"
          accessibilityLabel="Back to invoice draft"
        >
          <Text style={{ fontSize: 14, fontWeight: '700', color: Theme.accentBrownDeep }}>
            ← Back to draft
          </Text>
        </Pressable>
      ) : null}
      <ScrollView
        contentContainerStyle={{
          padding: Layout.screenPaddingHorizontal,
          paddingBottom: 40,
        }}
      >
        <View
          style={{
            backgroundColor: Theme.cardWhite,
            borderWidth: 1,
            borderColor: Theme.textPrimaryDark,
            padding: 16,
          }}
        >
          <Text style={{ fontSize: 13, fontWeight: '800', textAlign: 'right', color: Theme.textPrimaryDark }}>
            DRAFT TAX INVOICE
          </Text>
          <Text style={{ marginTop: 8, fontSize: 16, fontWeight: '800', color: Theme.textPrimaryDark }}>
            {invoiceData.brandingCompanyName}
          </Text>
          {invoiceData.issuerAddressLines.map((line) => (
            <Text key={line} style={{ fontSize: 12, color: Theme.textPrimaryDark, marginTop: 2 }}>
              {line}
            </Text>
          ))}
          {invoiceData.issuerGstin ? (
            <Text style={{ fontSize: 12, fontWeight: '600', marginTop: 4 }}>
              GSTIN {invoiceData.issuerGstin}
            </Text>
          ) : invoiceData.issuerGstNotApplicable ? (
            <Text style={{ fontSize: 12, marginTop: 4 }}>GST not applicable</Text>
          ) : null}

          <View style={{ height: 1, backgroundColor: Theme.textPrimaryDark, marginVertical: 12 }} />
          <Meta label="Invoice #" value={invoiceData.invoiceNo} />
          <Meta label="Invoice Date" value={invoiceData.previewDate} />
          <Meta label="Due Date" value={invoiceData.indicativeDueDate} />
          {shipment.mode === 'single' ? (
            <>
              <Meta label="Trip ID" value={shipment.trip_id} />
              <Meta label="LR Number" value={shipment.lr_number} />
              <Meta label="Pickup location" value={shipment.pickup} />
              <Meta label="Delivery Location" value={shipment.delivery} />
              <Meta label="Truck No" value={shipment.truck_no || shipment.vehicle_notes} />
              <Meta label="Truck Load Type" value={shipment.load_type} />
            </>
          ) : null}

          <View style={{ height: 1, backgroundColor: Theme.textPrimaryDark, marginVertical: 12 }} />
          <Text style={{ fontSize: 12, fontWeight: '700', marginBottom: 6 }}>Bill To</Text>
          {invoiceData.billingLines.map((line) => (
            <Text key={line} style={{ fontSize: 12, color: Theme.textPrimaryDark, marginTop: 2 }}>
              {line}
            </Text>
          ))}

          <View style={{ height: 1, backgroundColor: Theme.textPrimaryDark, marginVertical: 12 }} />
          {invoiceData.items
            .filter((item) => item.lineType === 'freight' || item.lineType === 'additional' || item.lineType === 'fuel')
            .map((item) => (
              <View key={item.key} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text style={{ flex: 1, fontSize: 12, fontWeight: '700' }}>{item.title || item.route}</Text>
                <Text style={{ fontSize: 12, fontWeight: '700' }}>
                  {item.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </Text>
              </View>
            ))}

          {invoiceData.amountInWords ? (
            <Text style={{ marginTop: 8, fontSize: 12, fontStyle: 'italic', fontWeight: '600' }}>
              {invoiceData.amountInWords}
            </Text>
          ) : null}

          <View style={{ marginTop: 12, alignItems: 'flex-end' }}>
            {invoiceData.taxRows
              .filter((row) => !(row.label === 'GST' && /not applicable/i.test(row.value)))
              .map((row) => (
                <Text key={row.label} style={{ fontSize: 12, marginBottom: 4 }}>
                  {row.label === 'Taxable amount' ? 'Sub Total' : row.label}: {row.value}
                </Text>
              ))}
            <Text style={{ fontSize: 13, fontWeight: '800' }}>
              Balance Due:{' '}
              {invoiceData.grandTotal.toLocaleString('en-IN', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
