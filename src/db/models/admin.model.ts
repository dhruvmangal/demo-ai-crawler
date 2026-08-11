import { DataTypes, Model, CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize';
import { sequelize } from '../../config/sequelize';

export class Admin extends Model<InferAttributes<Admin>, InferCreationAttributes<Admin>> {
  declare id: CreationOptional<string>;
  declare email: string;
  declare name: string;
  declare passwordHash: string;
  declare isSuperadmin: CreationOptional<boolean>;
  declare isActive: CreationOptional<boolean>;
  declare lastLoginAt: Date | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
}

Admin.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(255), allowNull: false },
    passwordHash: { type: DataTypes.TEXT, allowNull: false, field: 'password_hash' },
    isSuperadmin: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_superadmin' },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
    lastLoginAt: { type: DataTypes.DATE, allowNull: true, field: 'last_login_at' },
    createdAt: { type: DataTypes.DATE, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, field: 'updated_at' }
  },
  {
    sequelize,
    modelName: 'Admin',
    tableName: 'admins',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
);
