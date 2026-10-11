export interface ResponsiveColumn {
  key: string;
  label: string;
  align?: "start" | "end";
  /** The cell that names the row: a row header, and the card title on phones. */
  primary?: boolean;
  numeric?: boolean;
  mono?: boolean;
}

export type EditorState = "clean" | "dirty" | "saving" | "conflict" | "error" | "readonly";
