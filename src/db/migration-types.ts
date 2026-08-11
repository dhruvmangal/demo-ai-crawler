import { Sequelize } from 'sequelize';

export interface MigrationParams {
  context: Sequelize;
}
