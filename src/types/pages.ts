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

export type UiElementType = 'button' | 'form' | 'table' | 'dialog' | 'input';

export interface UiElement {
  id?: string;
  pageId: string;
  type: UiElementType;
  label: string;
  selector: string;
  role?: string;
  confidence: number;
  metadata?: any; // Extra details like fields, columns, action buttons, etc.
  aiDescription?: string | null;
}
