import React, { useMemo, useRef, useState } from 'react';
import type { InvoicePdfData } from '@/components/InvoicePdf.types';
import { buildInvoicePdfTableRows } from '@/features/invoicing/services/invoiceCnDn.service';
import Theme from '@/constants/Theme';

const font =
  'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

const ink = Theme.textPrimaryDark;
const rule = Theme.textPrimaryDark;
const labelInk = Theme.analyticsHeroBg;

function formatPlainAmount(amount: number): string {
  return amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatTaxInvoiceDate(value: string | null | undefined): string {
  const raw = (value ?? '').trim();
  if (!raw) return '';
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  const dd = String(parsed.getDate()).padStart(2, '0');
  const mm = String(parsed.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${parsed.getFullYear()}`;
}

function pageStyle(): React.CSSProperties {
  return {
    backgroundColor: Theme.cardWhite,
    width: '210mm',
    minHeight: '297mm',
    padding: 0,
    position: 'relative',
    boxSizing: 'border-box',
    color: ink,
    fontFamily: font,
    border: `1px solid ${rule}`,
  };
}

function cell(extra?: React.CSSProperties): React.CSSProperties {
  return {
    border: `1px solid ${rule}`,
    padding: '6px 8px',
    verticalAlign: 'top',
    ...extra,
  };
}

function thStyle(align: 'left' | 'right'): React.CSSProperties {
  return cell({
    fontSize: 11,
    fontWeight: 700,
    textAlign: align,
    backgroundColor: Theme.cardWhite,
    color: ink,
  });
}

function amountStyle(extra?: React.CSSProperties): React.CSSProperties {
  return {
    fontVariantNumeric: 'tabular-nums',
    fontFeatureSettings: '"tnum"',
    whiteSpace: 'nowrap',
    textAlign: 'right',
    ...extra,
  };
}

function TaxMetaRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  if (!value) return null;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '120px 8px minmax(0, 1fr)',
        columnGap: 4,
        alignItems: 'baseline',
        marginBottom: 3,
        fontSize: 11,
        lineHeight: 1.45,
      }}
    >
      <span style={{ color: labelInk, fontWeight: 600 }}>{label}</span>
      <span style={{ color: ink }}>:</span>
      <span style={{ color: ink, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

interface InvoicePdfWebProps {
  invoiceData: InvoicePdfData;
  initialShowSplit?: boolean;
  onBack?: () => void;
}

export default function InvoicePdfWeb({
  invoiceData,
  initialShowSplit = true,
  onBack,
}: InvoicePdfWebProps) {
  const printRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const [showSplit, setShowSplit] = useState(initialShowSplit);
  const logoUrl = logoFailed ? null : invoiceData.brandingLogoUrl;
  const tableRows = useMemo(
    () => buildInvoicePdfTableRows(invoiceData.items, { showSplit }),
    [invoiceData.items, showSplit],
  );
  const shipment = invoiceData.shipment;
  const title =
    invoiceData.documentKind === 'draft' ? 'DRAFT TAX INVOICE' : 'ORIGINAL TAX INVOICE';

  const taxLines = invoiceData.taxRows.filter((row) => {
    if (row.label === 'GST' && /not applicable/i.test(row.value)) return false;
    return true;
  });

  const handleDownloadPdf = async () => {
    if (!printRef.current) return;
    setIsGenerating(true);

    try {
      const element = printRef.current;
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf/dist/jspdf.es.min.js'),
      ]);
      const canvas = await html2canvas(element, { scale: 2, useCORS: true });
      const imgData = canvas.toDataURL('image/png');

      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'px',
        format: 'a4',
      });

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save('invoice_DRAFT.pdf');
    } catch (error) {
      console.error('Failed to generate PDF', error);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: Theme.analyticsCanvas,
        fontFamily: font,
      }}
    >
      <div
        style={{
          flexShrink: 0,
          position: 'sticky',
          top: 0,
          zIndex: 30,
          padding: '10px 20px',
          backgroundColor: Theme.screenBackground,
          borderBottom: `1px solid ${Theme.borderMedium}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <button
          type="button"
          onClick={onBack}
          disabled={!onBack}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            background: 'none',
            border: 'none',
            padding: '8px 4px',
            minHeight: 44,
            cursor: onBack ? 'pointer' : 'default',
            color: Theme.accentBrownDeep,
            fontSize: 14,
            fontWeight: 700,
            fontFamily: font,
            opacity: onBack ? 1 : 0.4,
          }}
        >
          ← Back to draft
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <div
            role="group"
            aria-label="Invoice line split"
            style={{
              display: 'flex',
              padding: 3,
              backgroundColor: Theme.liquidPillBg,
              border: `1px solid ${Theme.liquidPillBorder}`,
              borderRadius: 999,
            }}
          >
            <button type="button" onClick={() => setShowSplit(true)} style={segmentStyle(showSplit)}>
              Show split
            </button>
            <button type="button" onClick={() => setShowSplit(false)} style={segmentStyle(!showSplit)}>
              No split
            </button>
          </div>
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={isGenerating}
            style={{
              backgroundColor: isGenerating ? Theme.borderMedium : Theme.buttonPrimary,
              color: Theme.buttonPrimaryText,
              padding: '8px 16px',
              border: `${Theme.buttonPrimaryBorderWidth}px solid ${Theme.buttonPrimaryBorder}`,
              borderRadius: Theme.buttonPrimaryRadius,
              cursor: isGenerating ? 'not-allowed' : 'pointer',
              fontSize: 13,
              fontWeight: 600,
              minHeight: 44,
              fontFamily: font,
            }}
          >
            {isGenerating ? 'Generating…' : 'Download draft'}
          </button>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '28px 20px 40px',
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <div ref={printRef} style={pageStyle()}>
          <div
            style={{
              position: 'absolute',
              top: '42%',
              left: '50%',
              transform: 'translate(-50%, -50%) rotate(-28deg)',
              fontSize: 64,
              fontWeight: 700,
              letterSpacing: 12,
              color: Theme.borderMedium,
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
              zIndex: 0,
            }}
          >
            DRAFT
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', position: 'relative', zIndex: 1 }}>
            <tbody>
              <tr>
                <td style={cell({ width: '22%', textAlign: 'center' })}>
                  {logoUrl ? (
                    <img
                      src={logoUrl}
                      alt=""
                      style={{ height: 52, maxWidth: 140, objectFit: 'contain' }}
                      onError={() => setLogoFailed(true)}
                    />
                  ) : null}
                  {invoiceData.issuerMsme ? (
                    <div style={{ marginTop: 8, fontSize: 9, fontWeight: 700, color: ink, lineHeight: 1.35 }}>
                      MSME Reg No: {invoiceData.issuerMsme}
                    </div>
                  ) : null}
                </td>
                <td style={cell({ width: '48%' })}>
                  <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-0.02em', textTransform: 'uppercase', lineHeight: 1.25 }}>
                    {invoiceData.brandingCompanyName}
                  </div>
                  {invoiceData.issuerAddressLines.map((line, idx) => (
                    <div key={`addr-${idx}`} style={{ fontSize: 11, lineHeight: 1.45, marginTop: idx === 0 ? 6 : 0 }}>
                      {line}
                    </div>
                  ))}
                  {invoiceData.issuerGstNotApplicable ? (
                    <div style={{ fontSize: 11, marginTop: 4 }}>GST not applicable</div>
                  ) : invoiceData.issuerGstin ? (
                    <div style={{ fontSize: 11, marginTop: 4, fontWeight: 600 }}>GSTIN {invoiceData.issuerGstin}</div>
                  ) : invoiceData.issuerPan ? (
                    <div style={{ fontSize: 11, marginTop: 4 }}>PAN {invoiceData.issuerPan}</div>
                  ) : null}
                </td>
                <td style={cell({ width: '30%', textAlign: 'right', verticalAlign: 'middle' })}>
                  <div
                    style={{
                      fontSize: 18,
                      fontWeight: 800,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      lineHeight: 1.25,
                    }}
                  >
                    {title}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          <table style={{ width: '100%', borderCollapse: 'collapse', position: 'relative', zIndex: 1 }}>
            <tbody>
              <tr>
                <td style={cell({ width: '50%' })}>
                  <TaxMetaRow
                    label="Invoice #"
                    value={invoiceData.invoiceNo === 'DRAFT' ? 'DRAFT' : invoiceData.invoiceNo}
                  />
                  <TaxMetaRow label="Invoice Date" value={formatTaxInvoiceDate(invoiceData.previewDate)} />
                  <TaxMetaRow
                    label="Due Date"
                    value={formatTaxInvoiceDate(invoiceData.indicativeDueDate)}
                  />
                </td>
                <td style={cell({ width: '50%' })}>
                  {shipment.mode === 'single' ? (
                    <>
                      <TaxMetaRow label="Trip ID" value={shipment.trip_id} />
                      <TaxMetaRow label="Trip Date" value={formatTaxInvoiceDate(shipment.trip_date)} />
                      <TaxMetaRow label="LR Number" value={shipment.lr_number} />
                      <TaxMetaRow label="Pickup location" value={shipment.pickup} />
                      <TaxMetaRow label="Delivery Location" value={shipment.delivery} />
                      <TaxMetaRow label="Truck No" value={shipment.truck_no || shipment.vehicle_notes} />
                      <TaxMetaRow label="Truck Load Type" value={shipment.load_type} />
                    </>
                  ) : (
                    <>
                      <TaxMetaRow
                        label="Trips"
                        value={
                          shipment.mode === 'multi'
                            ? `${shipment.trip_count} trips billed as separate freight lines`
                            : '—'
                        }
                      />
                      {shipment.trips.slice(0, 3).map((trip) => (
                        <TaxMetaRow
                          key={trip.trip_id}
                          label={trip.trip_id}
                          value={[trip.lr_number, trip.truck_no].filter(Boolean).join(' · ') || trip.route}
                        />
                      ))}
                    </>
                  )}
                </td>
              </tr>
            </tbody>
          </table>

          <table style={{ width: '100%', borderCollapse: 'collapse', position: 'relative', zIndex: 1 }}>
            <tbody>
              <tr>
                <td style={cell({ backgroundColor: Theme.surfaceGray, fontWeight: 700, fontSize: 12 })}>
                  Bill To
                </td>
              </tr>
              <tr>
                <td style={cell({ padding: '8px 10px' })}>
                  {invoiceData.billingLines.length > 0 ? (
                    invoiceData.billingLines.map((line, idx) => (
                      <div
                        key={`bill-${idx}`}
                        style={{
                          fontSize: idx === 0 ? 13 : 11,
                          fontWeight: idx === 0 ? 800 : 400,
                          lineHeight: 1.45,
                          textTransform: idx === 0 ? 'uppercase' : undefined,
                        }}
                      >
                        {line}
                      </div>
                    ))
                  ) : (
                    <div style={{ fontSize: 13, fontWeight: 800 }}>{invoiceData.clientName}</div>
                  )}
                </td>
              </tr>
            </tbody>
          </table>

          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              position: 'relative',
              zIndex: 1,
              tableLayout: 'fixed',
            }}
          >
            <colgroup>
              <col style={{ width: '6%' }} />
              <col style={{ width: '46%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '17%' }} />
              <col style={{ width: '17%' }} />
            </colgroup>
            <thead>
              <tr>
                <th style={thStyle('left')}>#</th>
                <th style={thStyle('left')}>Item & Description</th>
                <th style={thStyle('left')}>HSN/SAC</th>
                <th style={thStyle('right')}>Rate</th>
                <th style={thStyle('right')}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((item, index) => {
                const isSplit = item.rowRole === 'split';
                const isRevised = item.rowRole === 'revised';
                const displayIndex =
                  item.rowRole === 'freight' || item.rowRole === 'other'
                    ? String(
                        tableRows
                          .slice(0, index + 1)
                          .filter((r) => r.rowRole === 'freight' || r.rowRole === 'other').length,
                      )
                    : '';
                const titleText = item.title || item.route;
                const rate = item.rate ?? item.amount;
                return (
                  <tr key={item.key}>
                    <td style={cell({ fontSize: 11, fontWeight: 700 })}>{displayIndex}</td>
                    <td style={cell({ fontSize: 11 })}>
                      <div style={{ fontWeight: isSplit || isRevised ? 500 : 700, textTransform: isSplit ? 'none' : 'uppercase' }}>
                        {titleText}
                      </div>
                      {item.subtitle && !isSplit ? (
                        <div style={{ marginTop: 2, color: Theme.textRouteCard, fontSize: 10 }}>{item.subtitle}</div>
                      ) : null}
                    </td>
                    <td style={cell({ fontSize: 11, textAlign: 'center' })}>
                      {!isSplit && !isRevised ? item.hsnSac || '' : ''}
                    </td>
                    <td style={cell(amountStyle({ fontSize: 11 }))}>
                      {!isSplit && !isRevised ? formatPlainAmount(rate) : ''}
                    </td>
                    <td
                      style={cell(
                        amountStyle({
                          fontSize: 11,
                          fontWeight: 600,
                          color:
                            item.splitKind === 'cn'
                              ? Theme.negative
                              : item.splitKind === 'dn'
                                ? Theme.positive
                                : ink,
                        }),
                      )}
                    >
                      {formatPlainAmount(item.amount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <table style={{ width: '100%', borderCollapse: 'collapse', position: 'relative', zIndex: 1 }}>
            <tbody>
              <tr>
                <td style={cell({ width: '58%', padding: '10px 12px' })}>
                  {invoiceData.amountInWords ? (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: labelInk }}>Total In Words</div>
                      <div style={{ marginTop: 3, fontSize: 12, fontStyle: 'italic', fontWeight: 600 }}>
                        {invoiceData.amountInWords}
                      </div>
                    </div>
                  ) : null}
                  <div style={{ fontSize: 11, fontWeight: 700, color: labelInk }}>Notes</div>
                  {invoiceData.notes ? (
                    <div style={{ marginTop: 3, fontSize: 11, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                      {invoiceData.notes}
                    </div>
                  ) : invoiceData.taxWarning ? (
                    <div style={{ marginTop: 3, fontSize: 11, color: Theme.warning }}>{invoiceData.taxWarning}</div>
                  ) : (
                    <div style={{ marginTop: 3, fontSize: 11, color: Theme.textRouteCard }}>
                      {invoiceData.invoiceNumberCaption}
                    </div>
                  )}
                  {invoiceData.paymentTerms ? (
                    <div style={{ marginTop: 8, fontSize: 11 }}>
                      Payment terms : <strong>{invoiceData.paymentTerms}</strong>
                    </div>
                  ) : null}
                  {invoiceData.bankDetailsLines.length > 0 ? (
                    <div style={{ marginTop: 12 }}>
                      {invoiceData.bankDetailsLines.map((line) => (
                        <div key={line} style={{ fontSize: 11, lineHeight: 1.5, fontWeight: 600 }}>
                          {line}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </td>
                <td style={{ width: '42%', padding: 0, verticalAlign: 'top' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                      {taxLines.map((row) => (
                        <tr key={row.label}>
                          <td style={cell({ fontSize: 11, textAlign: 'right', fontWeight: 600 })}>
                            {row.label === 'Taxable amount' ? 'Sub Total' : row.label}
                          </td>
                          <td style={cell(amountStyle({ fontSize: 11, fontWeight: 700, width: '46%' }))}>
                            {row.value.replace(/^₹\s?/, '')}
                          </td>
                        </tr>
                      ))}
                      <tr>
                        <td style={cell({ fontSize: 11, textAlign: 'right', fontWeight: 800 })}>Total</td>
                        <td style={cell(amountStyle({ fontSize: 11, fontWeight: 800 }))}>
                          {formatPlainAmount(invoiceData.grandTotal)}
                        </td>
                      </tr>
                      <tr>
                        <td style={cell({ fontSize: 11, textAlign: 'right', fontWeight: 800 })}>Balance Due</td>
                        <td style={cell(amountStyle({ fontSize: 11, fontWeight: 800 }))}>
                          {formatPlainAmount(invoiceData.grandTotal)}
                        </td>
                      </tr>
                      <tr>
                        <td colSpan={2} style={cell({ height: 88, textAlign: 'center', verticalAlign: 'bottom' })}>
                          <div style={{ fontSize: 10, color: Theme.textRouteCard, paddingBottom: 4 }}>
                            Authorized Signature
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function segmentStyle(active: boolean): React.CSSProperties {
  return {
    backgroundColor: active ? Theme.screenBackground : 'transparent',
    color: active ? Theme.textPrimaryDark : Theme.textRouteCard,
    padding: '8px 14px',
    border: 'none',
    borderRadius: 999,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    minHeight: 36,
    boxShadow: active ? '0 1px 2px rgba(15, 23, 42, 0.08)' : 'none',
    fontFamily: font,
  };
}
