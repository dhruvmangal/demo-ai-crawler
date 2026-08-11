import { DataTypes, Model, CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize';
import { sequelize } from '../../config/sequelize';

export type WorkflowType = 'EXTRACTED' | 'TOUR';

export class Workflow extends Model<InferAttributes<Workflow>, InferCreationAttributes<Workflow>> {
  declare id: CreationOptional<string>;
  declare projectId: string;
  declare name: string;
  declare confidence: CreationOptional<number>;
  declare type: CreationOptional<WorkflowType>;
  declare readonly createdAt: CreationOptional<Date>;
}

Workflow.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    projectId: { type: DataTypes.UUID, allowNull: false, field: 'project_id' },
    name: { type: DataTypes.STRING(255), allowNull: false },
    confidence: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 1.0 },
    type: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'EXTRACTED' },
    createdAt: { type: DataTypes.DATE, field: 'created_at' }
  },
  { sequelize, modelName: 'Workflow', tableName: 'workflows', timestamps: true, createdAt: 'created_at', updatedAt: false }
);
