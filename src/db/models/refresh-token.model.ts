import { DataTypes, Model, CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize';
import { sequelize } from '../../config/sequelize';

export type RefreshTokenSubjectType = 'user' | 'admin';

export class RefreshToken extends Model<InferAttributes<RefreshToken>, InferCreationAttributes<RefreshToken>> {
  declare id: CreationOptional<string>;
  declare subjectType: RefreshTokenSubjectType;
  declare userId: string | null;
  declare adminId: string | null;
  declare tokenHash: string;
  declare familyId: string;
  declare replacedByTokenId: string | null;
  declare revokedAt: Date | null;
  declare expiresAt: Date;
  declare ipAddress: string | null;
  declare userAgent: string | null;
  declare readonly createdAt: CreationOptional<Date>;
}

RefreshToken.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    subjectType: { type: DataTypes.STRING(10), allowNull: false, field: 'subject_type' },
    userId: { type: DataTypes.UUID, allowNull: true, field: 'user_id' },
    adminId: { type: DataTypes.UUID, allowNull: true, field: 'admin_id' },
    tokenHash: { type: DataTypes.TEXT, allowNull: false, unique: true, field: 'token_hash' },
    familyId: { type: DataTypes.UUID, allowNull: false, field: 'family_id' },
    replacedByTokenId: { type: DataTypes.UUID, allowNull: true, field: 'replaced_by_token_id' },
    revokedAt: { type: DataTypes.DATE, allowNull: true, field: 'revoked_at' },
    expiresAt: { type: DataTypes.DATE, allowNull: false, field: 'expires_at' },
    ipAddress: { type: DataTypes.STRING(100), allowNull: true, field: 'ip_address' },
    userAgent: { type: DataTypes.TEXT, allowNull: true, field: 'user_agent' },
    createdAt: { type: DataTypes.DATE, field: 'created_at' }
  },
  {
    sequelize,
    modelName: 'RefreshToken',
    tableName: 'refresh_tokens',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false
  }
);
