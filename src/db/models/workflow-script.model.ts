import { DataTypes, Model, CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize';
import { sequelize } from '../../config/sequelize';
import { StepMetadata } from '../../types/workflow-scripts';

export type WorkflowScriptStatus = 'ACTIVE' | 'NEEDS_REGENERATION';

export class WorkflowScript extends Model<InferAttributes<WorkflowScript>, InferCreationAttributes<WorkflowScript>> {
  declare id: CreationOptional<string>;
  declare workflowId: string;
  declare sourceCode: string;
  declare stepMetadata: StepMetadata[];
  declare status: CreationOptional<WorkflowScriptStatus>;
  declare version: CreationOptional<number>;
  declare model: string;
  declare generatedAt: CreationOptional<Date>;
  declare lastRunId: string | null;
  declare lastRunStatus: string | null;
  declare healCount: CreationOptional<number>;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
}

WorkflowScript.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    workflowId: { type: DataTypes.UUID, allowNull: false, unique: true, field: 'workflow_id' },
    sourceCode: { type: DataTypes.TEXT, allowNull: false, field: 'source_code' },
    stepMetadata: { type: DataTypes.JSONB, allowNull: false, field: 'step_metadata' },
    status: { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'ACTIVE' },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    model: { type: DataTypes.STRING(100), allowNull: false },
    generatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'generated_at' },
    lastRunId: { type: DataTypes.UUID, allowNull: true, field: 'last_run_id' },
    lastRunStatus: { type: DataTypes.STRING(50), allowNull: true, field: 'last_run_status' },
    healCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'heal_count' },
    createdAt: { type: DataTypes.DATE, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, field: 'updated_at' }
  },
  {
    sequelize,
    modelName: 'WorkflowScript',
    tableName: 'workflow_scripts',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
);
