// Ambient module declaration — `turndown-plugin-gfm` doesn't ship its own
// `.d.ts`. We only ever pass its exports through `turndown.use()`, so the
// runtime is content with the function values; TypeScript just needs to
// know they exist.
declare module "turndown-plugin-gfm" {
  import type TurndownService from "turndown";
  type Plugin = (service: TurndownService) => void;
  export const gfm: Plugin;
  export const highlightedCodeBlock: Plugin;
  export const strikethrough: Plugin;
  export const tables: Plugin;
  export const taskListItems: Plugin;
}
