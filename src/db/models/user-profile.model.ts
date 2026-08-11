import { DataTypes, Model, CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize';
import { sequelize } from '../../config/sequelize';

export class UserProfile extends Model<InferAttributes<UserProfile>, InferCreationAttributes<UserProfile>> {
  declare id: CreationOptional<string>;
  declare userId: string;
  declare gender: string | null;
  declare industry: string | null;
  declare roleTitle: string | null;
  declare usageIntent: string | null;
  declare defaultTargetAudience: string | null;
  declare onboardingCompletedAt: Date | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
}

UserProfile.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: { type: DataTypes.UUID, allowNull: false, unique: true, field: 'user_id' },
    gender: { type: DataTypes.STRING(30), allowNull: true },
    industry: { type: DataTypes.STRING(120), allowNull: true },
    roleTitle: { type: DataTypes.STRING(120), allowNull: true, field: 'role_title' },
    usageIntent: { type: DataTypes.TEXT, allowNull: true, field: 'usage_intent' },
    defaultTargetAudience: { type: DataTypes.TEXT, allowNull: true, field: 'default_target_audience' },
    onboardingCompletedAt: { type: DataTypes.DATE, allowNull: true, field: 'onboarding_completed_at' },
    createdAt: { type: DataTypes.DATE, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, field: 'updated_at' }
  },
  {
    sequelize,
    modelName: 'UserProfile',
    tableName: 'user_profiles',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
);
