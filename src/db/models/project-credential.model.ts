import { DataTypes, Model, CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize';
import { sequelize } from '../../config/sequelize';

// Persistent vault of working login credentials per project, keyed by project_id (not a
// generated id) so upsert-by-project is a single-key operation. See init.sql for why
// project_id has no FK: there is no projects table, same soft-reference convention used
// by pages.project_id etc.
export class ProjectCredential extends Model<InferAttributes<ProjectCredential>, InferCreationAttributes<ProjectCredential>> {
  declare projectId: string;
  declare username: string;
  declare password: string;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
}

ProjectCredential.init(
  {
    projectId: { type: DataTypes.UUID, primaryKey: true, field: 'project_id' },
    username: { type: DataTypes.TEXT, allowNull: false },
    password: { type: DataTypes.TEXT, allowNull: false },
    createdAt: { type: DataTypes.DATE, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, field: 'updated_at' }
  },
  { sequelize, modelName: 'ProjectCredential', tableName: 'project_credentials', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' }
);
