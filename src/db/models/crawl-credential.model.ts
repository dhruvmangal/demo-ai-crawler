import { DataTypes, Model, CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize';
import { sequelize } from '../../config/sequelize';

export class CrawlCredential extends Model<InferAttributes<CrawlCredential>, InferCreationAttributes<CrawlCredential>> {
  declare id: CreationOptional<string>;
  declare crawlJobId: string;
  declare username: string;
  declare password: string;
  declare readonly createdAt: CreationOptional<Date>;
}

CrawlCredential.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    crawlJobId: { type: DataTypes.UUID, allowNull: false, field: 'crawl_job_id' },
    username: { type: DataTypes.TEXT, allowNull: false },
    password: { type: DataTypes.TEXT, allowNull: false },
    createdAt: { type: DataTypes.DATE, field: 'created_at' }
  },
  { sequelize, modelName: 'CrawlCredential', tableName: 'crawl_credentials', timestamps: true, createdAt: 'created_at', updatedAt: false }
);
