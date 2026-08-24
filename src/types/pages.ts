export interface Page {
  id?: string;
  projectId: string;
  url: string;
  title: string;
  parentPageId?: string | null;
  viaLabel?: string | null;
  viaSelector?: string | null;
  breadcrumb?: string | null;
  domHash?: string;
  aiSummary?: string | null;
  aiDescription?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface PageSnapshot {
  id?: string;
  pageId: string;
  domHash: string;
  domJson: any; // JSON representation of the DOM
  createdAt?: Date;
}

export type UiElementType =
  | 'button' | 'link' | 'form' | 'input' | 'textarea' | 'select' | 'checkbox' | 'radio'
  | 'toggle' | 'table' | 'dialog' | 'tab' | 'nav-item' | 'breadcrumb' | 'pagination'
  | 'card' | 'image' | 'alert' | 'badge' | 'menu';

export interface UiElementStructure {
  tag: string;
  attributes: Record<string, string>;
  domPath: string;
  parentSelector?: string;
  childCount: number;
  textContent?: string;
}

export interface UiElementPosition {
  x: number;
  y: number;
  width: number;
  height: number;
  inViewport: boolean;
  documentY: number;
  region: 'header' | 'sidebar' | 'footer' | 'main' | 'modal' | 'unknown';
}

export interface UiElementStyling {
  color: string;
  backgroundColor: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  borderRadius: string;
  borderColor: string;
  borderWidth: string;
  boxShadow: string;
  cursor: string;
  opacity: string;
  zIndex: string;
  display: string;
  visibility: string;
}

export interface UiElementState {
  disabled?: boolean;
  required?: boolean;
  checked?: boolean;
  selected?: boolean;
  readonly?: boolean;
  expanded?: boolean;
}

/**
 * Set by StateExplorer (src/discovery/state-explorer.ts) on elements that only became
 * visible/present after a non-navigational interaction -- switching a tab, expanding an
 * accordion, opening a modal, or scrolling to trigger lazy/infinite-loaded content. Absent
 * on elements that were already visible on initial page load. This is what lets the feature
 * inventory distinguish "always there" from "gated behind interaction X", instead of
 * silently flattening both into the same page's element list.
 */
export interface UiElementDiscoveryTrigger {
  type: 'tab' | 'accordion' | 'modal' | 'infinite-scroll';
  triggerLabel: string;
  triggerSelector: string;
}

/**
 * Everything UiDiscovery captures beyond type/label/selector -- see
 * src/discovery/ui-discovery.ts. `purpose` is a keyword/context heuristic, not an LLM
 * call. The type-specific fields (fields/columns/rowActions/innerButtons) are the same
 * shapes the individual detectors already built; this is just where they now live.
 */
export interface UiElementMetadata {
  purpose: string;
  structure: UiElementStructure;
  position: UiElementPosition;
  styling: UiElementStyling;
  state: UiElementState;
  fields?: Array<{ name: string; label: string; type: string; required: boolean; pattern?: string; placeholder?: string }>;
  columns?: string[];
  rowActions?: string[];
  innerButtons?: string[];
  discoveredVia?: UiElementDiscoveryTrigger;
}

export interface UiElement {
  id?: string;
  pageId: string;
  type: UiElementType;
  label: string;
  selector: string;
  role?: string;
  confidence: number;
  metadata?: UiElementMetadata;
  aiDescription?: string | null;
}
