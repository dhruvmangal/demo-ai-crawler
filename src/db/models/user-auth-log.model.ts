import { DataTypes, Model, CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize';
import { sequelize } from '../../config/sequelize';

export type AuthEventType = 'SIGNUP' | 'LOGIN' | 'LOGOUT' | 'TOKEN_REFRESH';

export class UserAuthLog extends Model<InferAttributes<UserAuthLog>, InferCreationAttributes<UserAuthLog>> {
  declare id: CreationOptional<string>;
  declare userId: string;
  declare eventType: AuthEventType;
  declare provider: string;
  declare ipAddress: string | null;
  declare userAgent: string | null;
  declare metadata: Record<string, unknown> | null;
  declare readonly createdAt: CreationOptional<Date>;
}

UserAuthLog.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: { type: DataTypes.UUID, allowNull: false, field: 'user_id' },
    eventType: { type: DataTypes.STRING(50), allowNull: false, field: 'event_type' },
    provider: { type: DataTypes.STRING(50), allowNull: false },
    ipAddress: { type: DataTypes.STRING(100), allowNull: true, field: 'ip_address' },
    userAgent: { type: DataTypes.TEXT, allowNull: true, field: 'user_agent' },
    metadata: { type: DataTypes.JSONB, allowNull: true },
    createdAt: { type: DataTypes.DATE, field: 'created_at' }
  },
  {
    sequelize,
    modelName: 'UserAuthLog',
    tableName: 'user_auth_logs',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false
  }
);
