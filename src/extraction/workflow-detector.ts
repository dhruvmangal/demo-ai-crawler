import { Page, UiElement } from '../types/pages';
import { Entity, Action } from '../types/entities';
import { Workflow, WorkflowStep } from '../types/workflows';
import { v4 as uuidv4 } from 'uuid';

export class WorkflowDetector {
  /**
   * Deterministically detect sequences that constitute logical business workflows (e.g. Lead Management, Order Processing).
   */
  public static detect(
    projectId: string,
    pages: Page[],
    uiElements: UiElement[],
    entities: Entity[],
    actions: Action[]
  ): { workflows: Workflow[]; steps: WorkflowStep[] } {
    const workflows: Workflow[] = [];
    const steps: WorkflowStep[] = [];

    // Helper to find entity id by name
    const getEntity = (name: string) => entities.find(e => e.name.toLowerCase() === name.toLowerCase());

    // Common SaaS workflows to look for
    const workflowTemplates = [
      {
        name: 'Customer Management',
        triggerEntity: 'Customer',
        sequence: ['view', 'create', 'edit']
      },
      {
        name: 'Order Lifecycle',
        triggerEntity: 'Order',
        sequence: ['view', 'create', 'payment', 'invoice']
      },
      {
        name: 'Product Catalog Management',
        triggerEntity: 'Product',
        sequence: ['view', 'create', 'edit']
      },
      {
        name: 'Billing & Invoice Processing',
        triggerEntity: 'Invoice',
        sequence: ['view', 'create', 'refund', 'approve']
      }
    ];

    for (const template of workflowTemplates) {
      const entity = getEntity(template.triggerEntity);
      if (!entity) continue;

      // Collect potential actions/pages that belong to this workflow
      const relatedPages = pages.filter(p => p.url.toLowerCase().includes(template.triggerEntity.toLowerCase()));
      const relatedElements = uiElements.filter(el => el.label.toLowerCase().includes(template.triggerEntity.toLowerCase()));

      if (relatedPages.length > 0 || relatedElements.length > 0) {
        // Create the Workflow node
        const workflowId = uuidv4();
        workflows.push({
          id: workflowId,
          projectId,
          name: template.name,
          confidence: 0.90
        });


        // Track step sequences
        let stepNumber = 1;

        // Step 1: Browse/View Entity list
        const viewPage = relatedPages.find(p => !p.url.includes('/new') && !p.url.includes('/create') && !p.url.includes('/edit'));
        if (viewPage) {
          steps.push({
            workflowId,
            stepNumber: stepNumber++,
            pageId: viewPage.id,
            actionId: null,
            entityId: entity.id
          });
        }

        // Step 2: Form Interaction/Add action
        const addBtn = relatedElements.find(el => el.type === 'button' && (el.label.toLowerCase().includes('add') || el.label.toLowerCase().includes('create')));
        const addForm = relatedElements.find(el => el.type === 'form' && (el.label.toLowerCase().includes('add') || el.label.toLowerCase().includes('create')));
        
        if (addBtn || addForm) {
          // Find matching action
          const matchingAction = actions.find(a => a.entityId === entity.id && (a.actionType.toLowerCase() === 'create' || a.actionType.toLowerCase() === 'add'));
          
          steps.push({
            workflowId,
            stepNumber: stepNumber++,
            pageId: addForm ? (uiElements.find(u => u.id === addForm.id)?.pageId || viewPage?.id) : viewPage?.id,
            actionId: matchingAction?.id || null,
            entityId: entity.id
          });
        }

        // Step 3: Complete Action / Table row actions
        const rowActionBtn = relatedElements.find(el => el.type === 'table' && el.metadata?.rowActions?.some((ra: string) => ra.toLowerCase().includes('edit') || ra.toLowerCase().includes('delete')));
        if (rowActionBtn) {
          steps.push({
            workflowId,
            stepNumber: stepNumber++,
            pageId: viewPage?.id,
            actionId: null,
            entityId: entity.id
          });
        }
      }
    }

    return { workflows, steps };
  }
}
