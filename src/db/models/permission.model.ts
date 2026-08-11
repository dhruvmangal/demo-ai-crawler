import { DataTypes, Model, CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize';
import { sequelize } from '../../config/sequelize';

export class Permission extends Model<InferAttributes<Permission>, InferCreationAttributes<Permission>> {
  declare id: CreationOptional<string>;
  declare key: string;
  declare description: string | null;
  declare readonly createdAt: CreationOptional<Date>;
}

Permission.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    key: { type: DataTypes.STRING(100), allowNull: false, unique: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    createdAt: { type: DataTypes.DATE, field: 'created_at' }
  },
  {
    sequelize,
    modelName: 'Permission',
    tableName: 'permissions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false
  }
);
