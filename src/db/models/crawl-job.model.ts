import { DataTypes, Model, CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize';
import { sequelize } from '../../config/sequelize';

export type CrawlJobStatus = 'PENDING' | 'RUNNING' | 'AWAITING_CREDENTIALS' | 'ENRICHING' | 'COMPLETED' | 'FAILED';

export class CrawlJob extends Model<InferAttributes<CrawlJob>, InferCreationAttributes<CrawlJob>> {
  declare id: CreationOptional<string>;
  declare projectId: string;
  declare targetUrl: string;
  declare status: CrawlJobStatus;
  declare loginUrl: string | null;
  declare startedAt: Date | null;
  declare completedAt: Date | null;
  declare errorMessage: string | null;
  declare readonly createdAt: CreationOptional<Date>;
}

CrawlJob.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    projectId: { type: DataTypes.UUID, allowNull: false, field: 'project_id' },
    targetUrl: { type: DataTypes.TEXT, allowNull: false, field: 'target_url' },
    status: { type: DataTypes.STRING(50), allowNull: false },
    loginUrl: { type: DataTypes.TEXT, allowNull: true, field: 'login_url' },
    startedAt: { type: DataTypes.DATE, allowNull: true, field: 'started_at' },
    completedAt: { type: DataTypes.DATE, allowNull: true, field: 'completed_at' },
    errorMessage: { type: DataTypes.TEXT, allowNull: true, field: 'error_message' },
    createdAt: { type: DataTypes.DATE, field: 'created_at' }
  },
  { sequelize, modelName: 'CrawlJob', tableName: 'crawl_jobs', timestamps: true, createdAt: 'created_at', updatedAt: false }
);
