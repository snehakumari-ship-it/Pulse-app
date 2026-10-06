declare module "@/components/PdfViewer" {
  import { FunctionComponent } from "react";
    import type { StyleProp, ViewStyle } from "react-native";

  interface PdfViewerProps {
    pdfUri: string | null;
    style?: StyleProp<ViewStyle>;
    showToolbar?: boolean;
    /** 1 = 100% of the file. */
    zoom?: number;
    sizing?: "original" | "fit";
    page?: number;
    /** False lets a parent own drag-pan (e.g. after CSS rotate). Default true. */
    interactive?: boolean;
  }

  export const PdfViewer: FunctionComponent<PdfViewerProps>;
}
