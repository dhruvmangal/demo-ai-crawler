import { DataTypes, Model, CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize';
import { sequelize } from '../../config/sequelize';

export class CrawlSession extends Model<InferAttributes<CrawlSession>, InferCreationAttributes<CrawlSession>> {
  declare id: CreationOptional<string>;
  declare crawlJobId: string;
  declare storageState: object;
  declare readonly createdAt: CreationOptional<Date>;
}

CrawlSession.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    crawlJobId: { type: DataTypes.UUID, allowNull: false, field: 'crawl_job_id' },
    storageState: { type: DataTypes.JSONB, allowNull: false, field: 'storage_state' },
    createdAt: { type: DataTypes.DATE, field: 'created_at' }
  },
  { sequelize, modelName: 'CrawlSession', tableName: 'crawl_sessions', timestamps: true, createdAt: 'created_at', updatedAt: false }
);
