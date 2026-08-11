import { DataTypes, Model, CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize';
import { sequelize } from '../../config/sequelize';

export type HealOutcome = 'HEALED' | 'HEAL_FAILED';

export class WorkflowScriptHeal extends Model<InferAttributes<WorkflowScriptHeal>, InferCreationAttributes<WorkflowScriptHeal>> {
  declare id: CreationOptional<string>;
  declare workflowScriptId: string;
  declare workflowRunId: string | null;
  declare failedStepNumber: number | null;
  declare errorMessage: string | null;
  declare outcome: HealOutcome;
  declare diffSummary: string | null;
  declare readonly createdAt: CreationOptional<Date>;
}

WorkflowScriptHeal.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    workflowScriptId: { type: DataTypes.UUID, allowNull: false, field: 'workflow_script_id' },
    workflowRunId: { type: DataTypes.UUID, allowNull: true, field: 'workflow_run_id' },
    failedStepNumber: { type: DataTypes.INTEGER, allowNull: true, field: 'failed_step_number' },
    errorMessage: { type: DataTypes.TEXT, allowNull: true, field: 'error_message' },
    outcome: { type: DataTypes.STRING(50), allowNull: false },
    diffSummary: { type: DataTypes.TEXT, allowNull: true, field: 'diff_summary' },
    createdAt: { type: DataTypes.DATE, field: 'created_at' }
  },
  {
    sequelize,
    modelName: 'WorkflowScriptHeal',
    tableName: 'workflow_script_heals',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false
  }
);
