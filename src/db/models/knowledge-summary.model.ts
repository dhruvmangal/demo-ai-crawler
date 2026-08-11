import { DataTypes, Model, CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize';
import { sequelize } from '../../config/sequelize';

export class KnowledgeSummary extends Model<InferAttributes<KnowledgeSummary>, InferCreationAttributes<KnowledgeSummary>> {
  declare id: CreationOptional<string>;
  declare projectId: string;
  declare domain: string | null;
  declare summaryData: Record<string, unknown>;
  declare readonly createdAt: CreationOptional<Date>;
}

KnowledgeSummary.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    projectId: { type: DataTypes.UUID, allowNull: false, unique: true, field: 'project_id' },
    domain: { type: DataTypes.STRING(255), allowNull: true },
    summaryData: { type: DataTypes.JSONB, allowNull: false, field: 'summary_data' },
    createdAt: { type: DataTypes.DATE, field: 'created_at' }
  },
  {
    sequelize,
    modelName: 'KnowledgeSummary',
    tableName: 'knowledge_summaries',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false
  }
);
