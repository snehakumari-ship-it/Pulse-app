/**
 * Poppins-aware Text for the driver app. Maps fontWeight to the loaded
 * Poppins face so Android/web render true bold, not faux-bold Regular.
 */
import { DriverFontFamily } from '@/constants/DriverTypography';
import { Text, type TextProps, type TextStyle } from 'react-native';

function familyForWeight(weight: TextStyle['fontWeight'] | undefined): string {
  const w = String(weight ?? '400');
  if (w === '800' || w === '900' || w === 'bold') return DriverFontFamily.extraBold;
  if (w === '700') return DriverFontFamily.bold;
  if (w === '600' || w === 'semibold') return DriverFontFamily.semiBold;
  if (w === '500') return DriverFontFamily.medium;
  return DriverFontFamily.regular;
}

export function DriverText({ style, ...rest }: TextProps) {
  const flat = (Array.isArray(style) ? Object.assign({}, ...style.flat(8)) : style) as
    | TextStyle
    | undefined;
  const fontFamily = flat?.fontFamily ?? familyForWeight(flat?.fontWeight);
  return <Text {...rest} style={[style, { fontFamily }]} />;
}
