import { DataTypes, Model, CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize';
import { sequelize } from '../../config/sequelize';

export type WorkflowRunStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export class WorkflowRun extends Model<InferAttributes<WorkflowRun>, InferCreationAttributes<WorkflowRun>> {
  declare id: CreationOptional<string>;
  declare workflowId: string;
  declare projectId: string;
  declare status: WorkflowRunStatus;
  declare videoPath: string | null;
  declare captionsPath: string | null;
  declare errorMessage: string | null;
  declare startedAt: Date | null;
  declare completedAt: Date | null;
  declare readonly createdAt: CreationOptional<Date>;
}

WorkflowRun.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    workflowId: { type: DataTypes.UUID, allowNull: false, field: 'workflow_id' },
    projectId: { type: DataTypes.UUID, allowNull: false, field: 'project_id' },
    status: { type: DataTypes.STRING(50), allowNull: false },
    videoPath: { type: DataTypes.TEXT, allowNull: true, field: 'video_path' },
    captionsPath: { type: DataTypes.TEXT, allowNull: true, field: 'captions_path' },
    errorMessage: { type: DataTypes.TEXT, allowNull: true, field: 'error_message' },
    startedAt: { type: DataTypes.DATE, allowNull: true, field: 'started_at' },
    completedAt: { type: DataTypes.DATE, allowNull: true, field: 'completed_at' },
    createdAt: { type: DataTypes.DATE, field: 'created_at' }
  },
  { sequelize, modelName: 'WorkflowRun', tableName: 'workflow_runs', timestamps: true, createdAt: 'created_at', updatedAt: false }
);
