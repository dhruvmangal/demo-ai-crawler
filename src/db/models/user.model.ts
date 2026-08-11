import { DataTypes, Model, CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize';
import { sequelize } from '../../config/sequelize';

export type UserType = 'anonymous' | 'loggedin' | 'subscribed' | 'premium_subscribed';
export type UserProvider = 'local' | 'google' | 'github';

export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
  declare id: CreationOptional<string>;
  declare email: string;
  declare name: string;
  declare avatarUrl: string | null;
  declare provider: UserProvider;
  declare providerUserId: string | null;
  declare passwordHash: string | null;
  declare userType: CreationOptional<UserType>;
  declare emailVerifiedAt: Date | null;
  declare isActive: CreationOptional<boolean>;
  declare googleId: string | null;
  declare githubId: string | null;
  declare lastLoginAt: Date | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
}

User.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(255), allowNull: false },
    avatarUrl: { type: DataTypes.TEXT, allowNull: true, field: 'avatar_url' },
    provider: { type: DataTypes.STRING(50), allowNull: false },
    providerUserId: { type: DataTypes.STRING(255), allowNull: true, field: 'provider_user_id' },
    passwordHash: { type: DataTypes.TEXT, allowNull: true, field: 'password_hash' },
    userType: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'loggedin', field: 'user_type' },
    emailVerifiedAt: { type: DataTypes.DATE, allowNull: true, field: 'email_verified_at' },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
    googleId: { type: DataTypes.STRING(255), allowNull: true, field: 'google_id' },
    githubId: { type: DataTypes.STRING(255), allowNull: true, field: 'github_id' },
    lastLoginAt: { type: DataTypes.DATE, allowNull: true, field: 'last_login_at' },
    createdAt: { type: DataTypes.DATE, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, field: 'updated_at' }
  },
  {
    sequelize,
    modelName: 'User',
    tableName: 'users',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
);
