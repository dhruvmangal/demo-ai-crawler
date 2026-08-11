import { User } from './user.model';
import { UserAuthLog } from './user-auth-log.model';
import { UserProfile } from './user-profile.model';
import { Admin } from './admin.model';
import { Permission } from './permission.model';
import { AdminPermission } from './admin-permission.model';
import { RefreshToken } from './refresh-token.model';
import { EmailVerificationToken } from './email-verification-token.model';
import { PasswordResetToken } from './password-reset-token.model';
import { CrawlJob } from './crawl-job.model';
import { CrawlCredential } from './crawl-credential.model';
import { Workflow } from './workflow.model';
import { WorkflowRun } from './workflow-run.model';
import { WorkflowScript } from './workflow-script.model';
import { WorkflowScriptHeal } from './workflow-script-heal.model';
import { KnowledgeSummary } from './knowledge-summary.model';

User.hasMany(UserAuthLog, { foreignKey: 'userId', as: 'authLogs' });
UserAuthLog.belongsTo(User, { foreignKey: 'userId', as: 'user' });

User.hasOne(UserProfile, { foreignKey: 'userId', as: 'profile' });
UserProfile.belongsTo(User, { foreignKey: 'userId', as: 'user' });

User.hasMany(RefreshToken, { foreignKey: 'userId', as: 'refreshTokens' });
RefreshToken.belongsTo(User, { foreignKey: 'userId', as: 'user' });

Admin.hasMany(RefreshToken, { foreignKey: 'adminId', as: 'refreshTokens' });
RefreshToken.belongsTo(Admin, { foreignKey: 'adminId', as: 'admin' });

User.hasMany(EmailVerificationToken, { foreignKey: 'userId', as: 'emailVerificationTokens' });
EmailVerificationToken.belongsTo(User, { foreignKey: 'userId', as: 'user' });

User.hasMany(PasswordResetToken, { foreignKey: 'userId', as: 'passwordResetTokens' });
PasswordResetToken.belongsTo(User, { foreignKey: 'userId', as: 'user' });

Admin.belongsToMany(Permission, { through: AdminPermission, foreignKey: 'adminId', otherKey: 'permissionId', as: 'permissions' });
Permission.belongsToMany(Admin, { through: AdminPermission, foreignKey: 'permissionId', otherKey: 'adminId', as: 'admins' });

CrawlJob.hasMany(CrawlCredential, { foreignKey: 'crawlJobId', as: 'credentials' });
CrawlCredential.belongsTo(CrawlJob, { foreignKey: 'crawlJobId', as: 'crawlJob' });

Workflow.hasOne(WorkflowScript, { foreignKey: 'workflowId', as: 'script' });
WorkflowScript.belongsTo(Workflow, { foreignKey: 'workflowId', as: 'workflow' });

Workflow.hasMany(WorkflowRun, { foreignKey: 'workflowId', as: 'runs' });
WorkflowRun.belongsTo(Workflow, { foreignKey: 'workflowId', as: 'workflow' });

WorkflowScript.hasMany(WorkflowScriptHeal, { foreignKey: 'workflowScriptId', as: 'heals' });
WorkflowScriptHeal.belongsTo(WorkflowScript, { foreignKey: 'workflowScriptId', as: 'script' });

WorkflowRun.hasMany(WorkflowScriptHeal, { foreignKey: 'workflowRunId', as: 'heals' });
WorkflowScriptHeal.belongsTo(WorkflowRun, { foreignKey: 'workflowRunId', as: 'run' });

export {
  User,
  UserAuthLog,
  UserProfile,
  Admin,
  Permission,
  AdminPermission,
  RefreshToken,
  EmailVerificationToken,
  PasswordResetToken,
  CrawlJob,
  CrawlCredential,
  Workflow,
  WorkflowRun,
  WorkflowScript,
  WorkflowScriptHeal,
  KnowledgeSummary
};
