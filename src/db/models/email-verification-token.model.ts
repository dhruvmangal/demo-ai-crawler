import { DataTypes, Model, CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize';
import { sequelize } from '../../config/sequelize';

export class EmailVerificationToken extends Model<
  InferAttributes<EmailVerificationToken>,
  InferCreationAttributes<EmailVerificationToken>
> {
  declare id: CreationOptional<string>;
  declare userId: string;
  declare tokenHash: string;
  declare expiresAt: Date;
  declare consumedAt: Date | null;
  declare readonly createdAt: CreationOptional<Date>;
}

EmailVerificationToken.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: { type: DataTypes.UUID, allowNull: false, field: 'user_id' },
    tokenHash: { type: DataTypes.TEXT, allowNull: false, unique: true, field: 'token_hash' },
    expiresAt: { type: DataTypes.DATE, allowNull: false, field: 'expires_at' },
    consumedAt: { type: DataTypes.DATE, allowNull: true, field: 'consumed_at' },
    createdAt: { type: DataTypes.DATE, field: 'created_at' }
  },
  {
    sequelize,
    modelName: 'EmailVerificationToken',
    tableName: 'email_verification_tokens',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false
  }
);
