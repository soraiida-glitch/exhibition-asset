/**
 * Shared color tokens for the exhibition-booth UI (chat widget, roleplay/meeting-log/
 * sales-scoring/proposal panels). Single source of truth so a color change doesn't require
 * hunting through 5 separate injectXStyles() functions that used to each hardcode their own
 * unrelated accent color.
 */
export const THEME = {
  sora: '#0098bb',
  soraDeep: '#00728e',
  hinode: '#ff7a45',
  sun: '#ffc93c',
  ink: '#14233a',
  cloud: '#f5fbfc',
  mist: '#d8ecf0',
  mistLine: '#c3e0e6',
} as const;
