import { DataTypes, Model, CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize';
import { sequelize } from '../../config/sequelize';

export class AdminPermission extends Model<InferAttributes<AdminPermission>, InferCreationAttributes<AdminPermission>> {
  declare adminId: string;
  declare permissionId: string;
  declare readonly grantedAt: CreationOptional<Date>;
}

AdminPermission.init(
  {
    adminId: { type: DataTypes.UUID, allowNull: false, primaryKey: true, field: 'admin_id' },
    permissionId: { type: DataTypes.UUID, allowNull: false, primaryKey: true, field: 'permission_id' },
    grantedAt: { type: DataTypes.DATE, field: 'granted_at' }
  },
  {
    sequelize,
    modelName: 'AdminPermission',
    tableName: 'admin_permissions',
    timestamps: false
  }
);
