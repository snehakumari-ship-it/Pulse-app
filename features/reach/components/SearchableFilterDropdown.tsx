/**
 * Market filter sheet. Same bottom-sheet popup as the expense category picker.
 * Trigger chrome lives with the parent; this renders only while the menu is open.
 */
import Theme from '@/constants/Theme';
import { Check, Search, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type SearchableFilterOption = {
  value: string;
  label: string;
  /** Optional status tone for a leading color dot (STATUS menu). */
  tone?: 'neutral' | 'open' | 'negotiating' | 'awarded' | 'closed';
};

const TONE_DOT: Record<NonNullable<SearchableFilterOption['tone']>, string> = {
  neutral: Theme.textMuted,
  open: Theme.driverEmerald,
  negotiating: Theme.driverGold,
  awarded: Theme.driverSuccess,
  closed: Theme.textMuted,
};

export function SearchableFilterDropdown({
  title,
  searchable = false,
  searchPlaceholder = 'Search…',
  options,
  selectedValue,
  onSelect,
  onClose,
  maxHeight = 360,
  testID,
}: {
  title: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  options: ReadonlyArray<SearchableFilterOption>;
  selectedValue: string;
  onSelect: (value: string) => void;
  onClose: () => void;
  maxHeight?: number;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!searchable || !normalized) return options;
    return options.filter((opt) => opt.label.toLowerCase().includes(normalized));
  }, [options, searchable, normalized]);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modal}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityLabel={`Close ${title}`}
        />
        <View
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}
          testID={testID}
        >
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>{title}</Text>
          {searchable ? (
            <View style={styles.searchRow}>
              <Search size={14} color={Theme.textMuted} strokeWidth={2.2} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={searchPlaceholder}
                placeholderTextColor={Theme.textMuted}
                style={styles.searchInput}
                autoCorrect={false}
                autoCapitalize="none"
                clearButtonMode="never"
                accessibilityLabel={searchPlaceholder}
              />
              {query.length > 0 ? (
                <Pressable
                  onPress={() => setQuery('')}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  style={styles.clearSearch}
                >
                  <X size={14} color={Theme.textMuted} strokeWidth={2.4} />
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <ScrollView
            style={{ maxHeight }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
            bounces={false}
          >
        {filtered.length === 0 ? (
          <View style={styles.emptyRow}>
            <Text style={styles.emptyText}>No matches</Text>
          </View>
        ) : (
          filtered.map((opt, index) => {
            const selected = opt.value === selectedValue;
            const isLast = index === filtered.length - 1;
            return (
              <Pressable
                key={opt.value || '__any__'}
                onPress={() => onSelect(opt.value)}
                style={({ pressed }) => [
                  styles.row,
                  !isLast && styles.rowDivider,
                  selected && styles.rowSelected,
                  pressed && styles.rowPressed,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={opt.label}
              >
                <View style={styles.rowLeft}>
                  {opt.tone ? (
                    <View
                      style={[styles.toneDot, { backgroundColor: TONE_DOT[opt.tone] }]}
                    />
                  ) : null}
                  <Text
                    style={[styles.rowLabel, selected && styles.rowLabelSelected]}
                    numberOfLines={1}
                  >
                    {opt.label}
                  </Text>
                </View>
                {selected ? (
                  <Check size={16} color={Theme.driverEmeraldDark} strokeWidth={2.6} />
                ) : (
                  <View style={styles.checkSpacer} />
                )}
              </Pressable>
            );
          })
        )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Theme.overlayBackdrop,
  },
  sheet: {
    maxHeight: '72%',
    backgroundColor: Theme.cardWhite,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 10,
    paddingHorizontal: 16,
    gap: 8,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 999,
    backgroundColor: Theme.borderLight,
    marginBottom: 4,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Theme.textPrimaryDark,
    letterSpacing: -0.2,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.borderLight,
    backgroundColor: Theme.surfaceGray,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '500',
    color: Theme.textPrimaryDark,
    paddingVertical: 0,
    ...Platform.select({
      web: { outlineStyle: 'none' } as object,
      default: {},
    }),
  },
  clearSearch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Theme.cardWhite,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.borderLight,
  },
  rowSelected: {
    backgroundColor: Theme.driverEmeraldMuted,
  },
  rowPressed: {
    backgroundColor: Theme.surfaceGray,
  },
  rowLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toneDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  rowLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '600',
    color: Theme.textPrimaryDark,
    letterSpacing: -0.1,
  },
  rowLabelSelected: {
    color: Theme.driverEmeraldDark,
    fontWeight: '700',
  },
  checkSpacer: { width: 16, height: 16 },
  emptyRow: {
    paddingHorizontal: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 12,
    fontWeight: '500',
    color: Theme.textMuted,
  },
});
