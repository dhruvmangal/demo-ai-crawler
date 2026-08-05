export interface Entity {
  id?: string;
  projectId: string;
  name: string;
  entityType?: string;
  confidence: number;
  createdAt?: Date;
}

export interface Action {
  id?: string;
  entityId: string;
  actionType: string; // Create, Edit, Approve, Reject, Refund, etc.
  selector?: string;
  confidence: number;
  createdAt?: Date;
}

export interface Relationship {
  id?: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationshipType: string;
  confidence: number;
  createdAt?: Date;
}
